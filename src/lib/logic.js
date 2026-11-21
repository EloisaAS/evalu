// Core rules of evalU, taken from the thesis manuscript (Chapter 3, Tables 6, 8 and 9).
// Shared by the server (server/*.js) and the browser pages.
//
// - FR11  a class counts only if at least half of the class PLUS ONE answered (50 students -> 26)
// - FR13  qualifying subjects and several program chairs are averaged; an evaluator group with no
//         valid result is removed from the denominator (no dean -> computed over 60%); 2 decimals
// - Table 6  College faculty 40/40/20, Basic Education 40/20/20/20, Non-teaching: head <-> staff
// - Clinical Instructors (CIs, allied medical programs): evaluated by their students and the dean;
//            the interview gives no weights yet (shown as "??"), so they start at 50 / 50 for HR to change
// - FR17  release order: HR -> VPs (review and approve) -> individual faculty
// Anything the manuscript does not give (e.g. weights for evaluating Deans) stays blank (null)
// until HR enters it; no score is invented.

export const THRESHOLD = 0.5;           // the line drawn on progress bars (the rule itself is half PLUS ONE)
export const LOW_ITEM = 3.0;            // FR19: items averaging below "Satisfactory" (UB's 4-point scale) are flagged
export { MAX_RATING, SCALES, CLASS_TYPES } from './ubForms.js';
import { MAX_RATING, SCALES } from './ubForms.js';
import { defaultFormula, computeFinal, methodOf } from './formula.js';
export { METHODS, AGGREGATIONS, MISSING_RULES, ROUNDING_METHODS, roundBy, parseExpression, validateFormula, computeFinal, defaultFormula, formulaText, formulaWords, howInWords, methodOf, methodList } from './formula.js';

/* ---------- evaluation policy (HR changes it without a programmer; each period keeps the version it used) ---------- */
/**
 * The rules that turn answers into ratings. The defaults are UB's current practice (HRMC comprehensive
 * report and the interview); HR can change them under "Policy & rules". Every change becomes a new
 * version with a reason, so a closed period is always computed with the rules it was evaluated under.
 */
export const DEFAULT_POLICY = Object.freeze({
  participationPercent: 50,  // FR11: a class counts when this % of the class answered ...
  participationPlusOne: true, // ... plus one (UB: "half of the class plus one"); false = at least that %
  bands: [3.51, 3.0, 2.5],    // lowest score for Outstanding / Satisfactory / Fair; below = Poor
  lowItem: 3.0,               // FR19: items averaging below this are flagged
  decimals: 2,                // FR13: final ratings are rounded to this many decimals
  missingGroup: 'reweight',   // FR13: a group with no valid result: 'reweight' (remove it from the denominator) or 'incomplete' (no final rating)
  minAnonymity: 2,            // students' comments are shown only when at least this many students of that teacher answered
  approvalMode: 'all',        // FR17: 'all' VPs must approve, 'any' one VP is enough, or 'count' = at least approvalCount
  approvalCount: 1,
});
/** The policy in force now (the newest version HR saved). */
export const currentPolicy = (db) => ({ ...DEFAULT_POLICY, ...(db?.policies?.at(-1)?.policy || {}), version: db?.policies?.at(-1)?.version || 0 });
/** The policy of a period: the version it was created/closed with (NFR8), else the current one. */
export const policyFor = (db, periodId) => {
  const p = periodId && db?.periods?.find((x) => x.id === periodId);
  return p?.policy ? { ...DEFAULT_POLICY, ...p.policy } : currentPolicy(db);
};
/** Round to the policy's number of decimals (2 by default). */
export const roundTo = (x, d = 2) => (x == null ? null : Math.round((x + Number.EPSILON) * 10 ** d) / 10 ** d);

/** UB's rating interpretation (HRMC comprehensive report): 3.51-4.00, 3.00-3.50, 2.50-2.99, 2.49 and below (by default). */
export function interpretation(score, nonTeaching = false, policy = DEFAULT_POLICY) {
  if (score == null) return '';
  const [o, s2, f] = policy.bands || DEFAULT_POLICY.bands;
  const s = roundTo(score, policy.decimals ?? 2);
  const words = nonTeaching ? ['Excellent', 'Good', 'Fair', 'Poor'] : ['Outstanding', 'Satisfactory', 'Fair', 'Poor'];
  return s >= o ? words[0] : s >= s2 ? words[1] : s >= f ? words[2] : words[3];
}
/** The interpretation table printed on reports, from the policy's bands: [['3.51 - 4.00', 0], …]. */
export function bandTable(policy = DEFAULT_POLICY) {
  const [o, s, f] = policy.bands || DEFAULT_POLICY.bands;
  const d = policy.decimals ?? 2;
  const below = (x) => (x - 1 / 10 ** d).toFixed(d);
  return [[`${o.toFixed(d)} - 4.00`, 0], [`${s.toFixed(d)} - ${below(o)}`, 1], [`${f.toFixed(d)} - ${below(s)}`, 2], [`${below(f)} and below`, 3]];
}
export const INTERPRETATION_TABLE = bandTable(DEFAULT_POLICY);
/** The words for each rating (1..4) on a form: the item's own levels if it has them, else the form's scale. */
export const scaleOf = (ins) => SCALES[ins && String(ins.targetType).startsWith('NTP') ? 'perf' : 'demo'];
export const ratingWords = (ins, criterion) => (criterion?.levels?.length === MAX_RATING ? criterion.levels : scaleOf(ins));
export const REMIND_DAYS = 7;           // FR10: automatic reminders start this many days before the deadline
export const INSTITUTION_DOMAIN = 'ubaguio.edu';

/** FR1: only official UB addresses (…@ubaguio.edu, including …@s.ubaguio.edu for students). */
export const isInstitutionalEmail = (e) =>
  typeof e === 'string' && /^[a-z0-9._%+-]+@([a-z0-9-]+\.)*ubaguio\.edu$/i.test(e.trim());

/** FR11: responses needed for a class to count: half of the class plus one (by default; HR can change the policy). */
export function neededResponses(enrolled, policy = DEFAULT_POLICY) {
  if (!enrolled) return 0;
  const p = Number(policy.participationPercent ?? 50);
  const n = policy.participationPlusOne === false ? Math.ceil((enrolled * p) / 100) : Math.floor((enrolled * p) / 100) + 1;
  return Math.min(enrolled, Math.max(1, n));
}

/** FR6: internship, practicum and field trip subjects are not evaluated. */
export const EXEMPT_SUBJECT = /\b(intern(ship)?s?|practicum|ojt|field ?trips?)\b/i;
export const isExemptSection = (s) => EXEMPT_SUBJECT.test(`${s.subject} ${s.code}`);

/**
 * The departments of the University of Baguio. HR can rename, add or remove departments later
 * (Accounts → Departments). "kind" decides the weights: college or basic (Basic Education).
 */
export const UB_DEPARTMENTS = [
  { id: 'SBAA', name: 'School of Business Administration & Accountancy (SBAA)', kind: 'college' },
  { id: 'SCJPS', name: 'School of Criminal Justice & Public Safety (SCJPS)', kind: 'college' },
  { id: 'SOD', name: 'School of Dentistry (SOD)', kind: 'college' },
  { id: 'SEA', name: 'School of Engineering & Architecture (SEA)', kind: 'college' },
  { id: 'SIT', name: 'School of Information Technology (SIT)', kind: 'college' },
  { id: 'SIHTM', name: 'School of International Hospitality & Tourism Management (SIHTM)', kind: 'college' },
  { id: 'SOL', name: 'School of Law (SOL)', kind: 'college' },
  { id: 'SNS', name: 'School of Natural Sciences (SNS)', kind: 'college' },
  { id: 'SON', name: 'School of Nursing (SON)', kind: 'college' },
  { id: 'STELA', name: 'School of Teacher Education & Liberal Arts (STELA)', kind: 'college' },
  { id: 'GS', name: 'Graduate School', kind: 'college' },
  { id: 'BE', name: 'Basic Education', kind: 'basic' },
];
/** The UB departments that are not in the system yet (matched by id or name). */
export const missingUbDepartments = (db) =>
  UB_DEPARTMENTS.filter((d) => !db.departments.some((x) => x.id === d.id || x.name.toLowerCase() === d.name.toLowerCase()));

export const ROLES = {
  ST: 'Student',
  TP: 'Teaching Personnel',
  NTP: 'Non-Teaching Personnel',
  HR: 'HR Specialist',
  DIR: 'Vice President',
};

// Positions allowed for each role (used when HR creates or edits an account).
export const POSITIONS = {
  ST: { student: 'Student' },
  TP: { faculty: 'Faculty', ci: 'Clinical Instructor (CI)', dean: 'Dean', chair: 'Program Chair', principal: 'Principal', aprincipal: 'Assistant Principal', shead: 'Subject Head' },
  NTP: { secretary: 'Secretary', staff: 'Staff', head: 'Office Head' },
  HR: { hr: 'HR Specialist', assistant: 'HRMC Assistant' },
  DIR: { vp: 'Vice President' },
};
/** Roles that belong to a department. */
export const needsDept = (role) => role === 'ST' || role === 'TP' || role === 'NTP';
/** Clinical Instructors are only in the School of Nursing (their students are Nursing students). */
export const isNursingDept = (d) => !!d && (d.id === 'SON' || /nursing/i.test(d.name));
export const nursingDepts = (db) => db.departments.filter(isNursingDept);
/** Someone who teaches classes: faculty and Clinical Instructors. */
export const isTeacher = (u) => !!u && u.role === 'TP' && (u.position === 'faculty' || u.position === 'ci');

export const GROUPS = {
  ST: 'Students',
  DEAN: 'Dean',
  CHAIR: 'Program Chair',
  SEC: 'Secretary',
  FAC: 'Faculty',
  PRIN: 'Principal',
  APRIN: 'Assistant Principal',
  SHEAD: 'Subject Head',
  NTPHEAD: 'Office Head',
  NTPSTAFF: 'Office Staff',
};
export const DEFAULT_EVALUATOR_GROUPS = Object.entries(GROUPS).map(([id, name]) => ({ id, name, builtIn: true, active: true }));
export const groupName = (db, id) => db?.evaluatorGroups?.find((g) => g.id === id)?.name || GROUPS[id] || id;

export const TARGET_TYPES = {
  COLLEGE_FACULTY: 'College faculty',
  BASICED_TEACHER: 'Basic Ed teacher',
  CI: 'Clinical Instructor (CI)',
  DEAN: 'Dean',
  NTP_STAFF: 'Non-teaching staff',
  NTP_HEAD: 'Non-teaching office head',
};

export const STAGES = ['hr', 'dir', 'faculty'];
export const STAGE_LABEL = {
  hr: 'HR Specialist only',
  dir: 'With the VPs for review and approval',
  faculty: 'Released to individual faculty',
};

/** The built-in group memberships used by accounts created before HR-managed memberships existed. */
export function defaultEvaluatorGroups(role, position) {
  if (role === 'ST') return ['ST'];
  if (role === 'NTP') return { secretary: ['SEC', 'NTPSTAFF'], staff: ['NTPSTAFF'], head: ['NTPHEAD'] }[position] || [];
  if (role === 'TP') {
    const g = { dean: 'DEAN', chair: 'CHAIR', principal: 'PRIN', aprincipal: 'APRIN', shead: 'SHEAD', faculty: 'FAC' }[position];
    return g ? [g] : [];
  }
  return [];
}
/** Every evaluation group assigned to a person; system account roles remain separate. */
export function evaluatorGroups(u) {
  if (!u) return [];
  if (u.role === 'ST') return ['ST'];
  if (Array.isArray(u.evaluatorGroupIds)) return [...new Set(u.evaluatorGroupIds)];
  return defaultEvaluatorGroups(u.role, u.position);
}
export const evaluatorGroup = (u) => evaluatorGroups(u)[0] || null;

export function targetType(db, u) {
  if (!u) return null;
  if (u.role === 'TP') {
    if (u.position === 'dean') return 'DEAN';
    if (u.position === 'ci') return 'CI';
    if (u.position === 'faculty') {
      const d = db.departments.find((x) => x.id === u.dept);
      return d?.kind === 'basic' ? 'BASICED_TEACHER' : 'COLLEGE_FACULTY';
    }
    return null;
  }
  if (u.role === 'NTP') return u.position === 'head' ? 'NTP_HEAD' : 'NTP_STAFF';
  return null;
}
/** People who get evaluation results of their own (faculty, Clinical Instructors, deans, non-teaching personnel). */
export const isEvaluatee = (u) => (u.role === 'TP' && ['faculty', 'ci', 'dean'].includes(u.position)) || u.role === 'NTP';

export const userById = (db, id) => db.users.find((u) => u.id === id);
export const deptName = (db, id) => db.departments.find((d) => d.id === id)?.name || id;
export const periodById = (db, id) => db.periods.find((p) => p.id === id);
const active = (u) => u && u.active !== false;

/** Department heads alerted about progress (deans, program chairs, principals). */
export const deptHeads = (db, dept) =>
  db.users.filter((u) => active(u) && u.dept === dept && u.role === 'TP' && ['dean', 'chair', 'principal', 'aprincipal'].includes(u.position));
/** FR16/FR18: who receives department results: the dean (college) or principal (Basic Ed). */
export const isResultHead = (u) => u.role === 'TP' && (u.position === 'dean' || u.position === 'principal');
export const resultHeads = (db, dept) => db.users.filter((u) => active(u) && u.dept === dept && isResultHead(u));
export const hrUsers = (db) => db.users.filter((u) => active(u) && u.role === 'HR');
/** FR17: only the Vice Presidents approve results (UB has no Director step). */
export const directors = (db) => db.users.filter((u) => active(u) && u.role === 'DIR' && u.position === 'vp');

/* ---------- forms (FR3, FR4) ---------- */
/**
 * The form in use for a pairing. Most specific first: for this type of class and department, for this
 * type of class, for this department, then the general one. "Type of class" (lecture, laboratory,
 * clinical...) is set per class; lecture is the standard form.
 */
export function instrumentFor(db, tt, group, dept = null, variant = null) {
  const list = db.instruments.filter((i) => i.targetType === tt && i.group === group && i.active !== false);
  const v = (i) => i.variant || null;
  return (variant && dept && list.find((i) => v(i) === variant && i.dept === dept))
    || (variant && list.find((i) => v(i) === variant && !i.dept))
    || (dept && list.find((i) => !v(i) && i.dept === dept))
    || list.find((i) => !v(i) && !i.dept) || null;
}
/**
 * The type of class a task is about: the class itself for students; for the dean or program chair,
 * the type most of the person's evaluated classes have (e.g. a clinical instructor in the dental infirmary).
 */
export function taskVariant(db, task) {
  if (task.sectionId) return db.sections.find((s) => s.id === task.sectionId)?.classType || null;
  const count = {};
  for (const s of db.sections) if (s.facultyId === task.targetId && !isExemptSection(s)) count[s.classType || ''] = (count[s.classType || ''] || 0) + 1;
  const top = Object.entries(count).sort((a, b) => b[1] - a[1])[0];
  return top?.[0] || null;
}
/** The form a not-yet-submitted task is answered on. */
export function formForTask(db, task) {
  const tg = userById(db, task.targetId);
  return tg ? instrumentFor(db, targetType(db, tg), task.group, tg.dept, taskVariant(db, task)) : null;
}
/** The form a task was (or will be) answered on: the version stored with a submitted response. */
export const formOfTask = (db, task) =>
  (task.response?.instrumentId && db.instruments.find((i) => i.id === task.response.instrumentId)) || formForTask(db, task);
/** FR4: a form that already has submitted evaluations can't be edited; a new version is made instead. */
export const formUsed = (db, ins) => db.tasks.some((t) => t.response && t.response.instrumentId === ins.id);
export const itemCategory = (it) => (it.category || '').trim() || 'General';

/**
 * FR3: weight of each item at submission. If the form gives every category a weight
 * (e.g. 60% / 40%), each category gets its share, split among its items by item weight.
 * Otherwise the item weights are used directly.
 */
export function effectiveWeights(ins) {
  const cats = ins.categories || {};
  const useCats = Object.keys(cats).length > 0 && ins.items.every((it) => Number(cats[itemCategory(it)]) > 0);
  if (!useCats) return Object.fromEntries(ins.items.map((it) => [it.criterionId, Number(it.weight)]));
  const sum = {};
  for (const it of ins.items) sum[itemCategory(it)] = (sum[itemCategory(it)] || 0) + Number(it.weight);
  return Object.fromEntries(ins.items.map((it) => {
    const c = itemCategory(it);
    return [it.criterionId, sum[c] ? (Number(cats[c]) * Number(it.weight)) / sum[c] : 0];
  }));
}

// ---------- task status ----------
export function taskStatus(db, task) {
  if (task.response) return 'completed';
  const p = periodById(db, task.periodId);
  if (p && new Date(p.deadline + 'T23:59:59') < new Date()) return 'overdue';
  return 'pending';
}

// ---------- scoring ----------
export function responseScore(resp) {
  let sw = 0, s = 0;
  for (const [cid, w] of Object.entries(resp.weights)) {
    const v = resp.answers[cid];
    if (v == null) continue;
    sw += w;
    s += w * v;
  }
  return sw ? s / sw : null;
}
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
/** FR13: final ratings are rounded to two decimal places. */
export const round2 = (x) => (x == null ? null : Math.round((x + Number.EPSILON) * 100) / 100);

export function sectionStats(db, periodId, sectionId, participation = null) {
  const sec = db.sections.find((s) => s.id === sectionId);
  const tasks = db.tasks.filter((t) => t.periodId === periodId && t.sectionId === sectionId && t.group === 'ST');
  const required = tasks.length;
  const done = tasks.filter((t) => t.response);
  const needed = neededResponses(required, { ...policyFor(db, periodId), ...(participation || {}) });
  const rate = required ? done.length / required : 0;
  const valid = required > 0 && done.length >= needed;
  const score = valid ? mean(done.map((t) => responseScore(t.response))) : null;
  return { section: sec, required, responded: done.length, needed, rate, valid, score, belowHalf: required > 0 && !valid };
}

/** NFR8: group weights in force for a period (fixed when the period is closed). */
export const rulesFor = (db, periodId) => periodById(db, periodId)?.rules || db.rules;

/* ---------- FR13: the final rating, computed by the formula engine (src/lib/formula.js) ---------- */
/** The key of a formula: per evaluated category, optionally only for one department (a condition). */
export const formulaKey = (tt, dept) => (dept ? `${tt}|${dept}` : tt);
/** The formula version in use now for a category (a department-specific one wins). */
export function activeFormula(db, tt, dept) {
  const list = (db.formulas || []).filter((f) => f.status === 'active' && f.targetType === tt);
  return (dept && list.find((f) => f.dept === dept)) || list.find((f) => !f.dept) || null;
}
/** A formula record as the engine needs it (its rules plus its identity). */
export const formulaSnapshot = (rec) => ({ ...rec.config, methodVersion: rec.config.methodVersion ?? 1, id: rec.id, version: rec.version, key: rec.key, dept: rec.dept || null });
/**
 * The formula a period uses for a category: the version fixed in the period (NFR8), else the active one
 * (for previews outside a period), else the starting formula (the starting percentages saved at setup).
 */
export function formulaFor(db, periodId, tt, dept) {
  const p = periodId && periodById(db, periodId);
  const snap = p?.formulas || {};
  const fixed = (dept && snap[formulaKey(tt, dept)]) || snap[tt];
  if (fixed) return fixed;
  if (!p) { const a = activeFormula(db, tt, dept); if (a) return formulaSnapshot(a); }
  return defaultFormula(rulesFor(db, periodId)[tt] || {}, policyFor(db, periodId));
}
/** Evaluation groups that have a form for a category (only those can be put in its formula). */
export const formGroups = (db, tt) => [...new Set(db.instruments.filter((i) => i.active !== false && i.targetType === tt).map((i) => i.group))];
const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/**
 * A person's result for a period. opts.formula runs another formula on the same answers (the simulator).
 * The result keeps the formula used, each group's contribution (breakdown) and the computation steps.
 */
export function computeTarget(db, periodId, targetId, opts = {}) {
  const target = userById(db, targetId);
  const tt = targetType(db, target);
  const f = opts.formula || formulaFor(db, periodId, tt, target?.dept);
  const comps = f.components || [];
  const groups = {};
  const sections = [];
  const m = methodOf(f.method, f.methodVersion ?? 1);
  const policy = policyFor(db, periodId);
  const participation = {
    participationPercent: f.participation?.percent ?? policy.participationPercent,
    participationPlusOne: f.participation?.plusOne ?? policy.participationPlusOne,
  };
  const shown = (c) => (m?.usesWeights ? c.weight : m?.equalShares ? +(100 / comps.length).toFixed(2) : null);
  for (const c of comps) {
    const g = c.group;
    const tasks = db.tasks.filter((t) => t.periodId === periodId && t.targetId === targetId && t.group === g);
    if (g === 'ST') {
      const secIds = [...new Set(tasks.map((t) => t.sectionId))];
      const st = secIds.map((id) => sectionStats(db, periodId, id, participation));
      sections.push(...st);
      const valid = st.filter((x) => x.valid);
      // aggregation: average of each class's average (UB practice), or all counted students together
      const score = c.aggregation === 'POOLED'
        ? mean(tasks.filter((t) => t.response && valid.some((x) => x.section?.id === t.sectionId)).map((t) => responseScore(t.response)))
        : mean(valid.map((x) => x.score));
      groups[g] = { weight: shown(c), score, required: tasks.length, responded: tasks.filter((t) => t.response).length, invalidSections: st.filter((x) => !x.valid).length, aggregation: c.aggregation };
    } else {
      const done = tasks.filter((t) => t.response);
      const scores = done.map((t) => responseScore(t.response));
      groups[g] = { weight: shown(c), score: c.aggregation === 'MEDIAN' ? median(scores) : mean(scores), required: tasks.length, responded: done.length, aggregation: c.aggregation };
    }
  }
  const missingW = m?.usesWeights ? comps.filter((c) => c.weight == null || c.weight === '').map((c) => c.group) : [];
  const total = m?.usesWeights ? comps.reduce((a, c) => a + (Number(c.weight) || 0), 0) : 100;
  const r = computeFinal(f, Object.fromEntries(Object.entries(groups).map(([g, x]) => [g, x.score])));
  return {
    targetId, target, type: tt, groups, sections, final: r.final, status: r.status, missing: r.missing, missingW, basis: r.basis, total,
    // the whole formula version is kept with the result, so it can be recomputed exactly later
    formula: { id: f.id || null, key: f.key || tt, name: f.name, version: f.version ?? 0, method: f.method, methodVersion: f.methodVersion ?? 1, components: comps.map((c) => ({ group: c.group, weight: c.weight ?? null, aggregation: c.aggregation, transform: c.transform || '' })), expression: f.expression || '', missing: f.missing, minGroups: f.minGroups ?? 1, participation: f.participation || null, effectiveFrom: f.effectiveFrom || '', effectiveUntil: f.effectiveUntil || '', rounding: f.rounding },
    breakdown: r.breakdown, steps: r.steps, how: r.how,
  };
}
/** A result that has a final score (complete, or re-weighted because a group is missing). */
export const hasFinal = (r) => r.final != null;

export function targetsOf(db) {
  return db.users.filter((u) => targetType(db, u));
}

export function computeAll(db, periodId) {
  return targetsOf(db).map((u) => computeTarget(db, periodId, u.id));
}

/**
 * When a period closes, every final result is stored with the formula version (its parameters and its
 * approval), the ratings used, the breakdown and the steps. Later changes to formulas, policies or the
 * program cannot silently change them, and each can be computed again exactly (reproducibility).
 */
export function storeResults(db, p) {
  const at = new Date().toISOString();
  db.results = (db.results || []).filter((r) => r.periodId !== p.id);
  for (const r of computeAll(db, p.id)) {
    const rec = r.formula.id && (db.formulas || []).find((f) => f.id === r.formula.id);
    db.results.push({ periodId: p.id, targetId: r.targetId, data: {
      final: r.final, status: r.status, basis: r.basis, steps: r.steps, how: r.how,
      // the formula version with its parameters, and its approval (the starting formula has none)
      formula: { ...r.formula, approvedBy: rec?.meta.approvedBy || null, approvedAt: rec?.meta.approvedAt || null, basis: rec?.meta.basis || null },
      groups: Object.fromEntries(Object.entries(r.groups).map(([g, x]) => [g, { score: x.score, weight: x.weight, responded: x.responded, required: x.required }])),
      breakdown: r.breakdown, computedAt: at,
    } });
  }
}

/**
 * FR15/FR16/FR19: per-item results. For each criterion: number of answers, the mean and the
 * distribution of ratings 1..4. Student identities are never part of this.
 */
export function itemStats(tasks, lowItem = LOW_ITEM) {
  const m = new Map();
  for (const t of tasks) {
    if (!t.response || t.response.redacted) continue;
    for (const [cid, v] of Object.entries(t.response.answers)) {
      const x = m.get(cid) || { criterionId: cid, n: 0, sum: 0, dist: Array(MAX_RATING).fill(0) };
      x.n++; x.sum += v; if (v >= 1 && v <= MAX_RATING) x.dist[v - 1]++;
      m.set(cid, x);
    }
  }
  return [...m.values()].map((x) => ({ ...x, mean: x.sum / x.n, low: x.sum / x.n < lowItem, cut: lowItem }));
}

// ---------- tasks / workflow ----------
/** FR8: a period covers every department, or only the ones HR selected. */
export const periodCovers = (p, dept) => !p?.depts?.length || p.depts.includes(dept);

export function expectedAssignments(db, periodId) {
  // Rule-based evaluator assignment from user attributes (role, position, department) and class lists.
  // Deactivated accounts get no new tasks (their past results stay in the reports).
  const p = periodById(db, periodId);
  const out = [];
  for (const t of targetsOf(db).filter(active)) {
    if (!periodCovers(p, t.dept)) continue;
    const tt = targetType(db, t);
    for (const g of Object.keys(rulesFor(db, periodId)[tt] || {})) {
      if (g === 'ST') {
        for (const sec of db.sections.filter((s) => s.facultyId === t.id && !isExemptSection(s)))
          for (const sid of sec.studentIds.filter((id) => active(userById(db, id)))) out.push({ evaluatorId: sid, targetId: t.id, group: g, sectionId: sec.id });
      } else {
        for (const e of db.users.filter((u) => active(u) && u.dept === t.dept && evaluatorGroups(u).includes(g) && u.id !== t.id))
          out.push({ evaluatorId: e.id, targetId: t.id, group: g, sectionId: null });
      }
    }
  }
  return out;
}

export function generateTasks(draft, periodId) {
  // idempotent; returns {added, skippedNoForm}
  const have = new Set(draft.tasks.filter((t) => t.periodId === periodId).map((t) => `${t.evaluatorId}|${t.targetId}|${t.group}|${t.sectionId || ''}`));
  let added = 0, skippedNoForm = 0;
  for (const a of expectedAssignments(draft, periodId)) {
    const key = `${a.evaluatorId}|${a.targetId}|${a.group}|${a.sectionId || ''}`;
    if (have.has(key)) continue;
    if (!formForTask(draft, a)) { skippedNoForm++; continue; }
    draft.tasks.push({ id: uid('t'), periodId, ...a, draft: null, response: null });
    added++;
  }
  return { added, skippedNoForm };
}

let _n = 0;
export const uid = (p) => `${p}_${Date.now().toString(36)}${(_n++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
export const today = () => new Date().toISOString().slice(0, 10);

/** Adds a notification unless one with the same key already exists. Returns true if added. */
export function notify(draft, { key, userId, kind, text }) {
  if (key && draft.notifications.some((n) => n.key === key)) return false;
  draft.notifications.push({ id: uid('n'), key, userId, kind, at: new Date().toISOString(), read: false, text });
  return true;
}
const fmtDate = (d) => new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

// ---------- FR11 / FR12: participation threshold + notifying the parties concerned ----------
/**
 * Notifies the faculty member, the department heads and HR about every class at or below half.
 * final = false: progress warning while the period is open (once a day).
 * final = true:  the period was closed and these classes are excluded (once).
 * Returns the number of classes below the threshold.
 */
function participationNotices(draft, periodId, final) {
  const p = periodById(draft, periodId);
  const day = today();
  const low = draft.sections.map((s) => {
    const target = userById(draft, s.facultyId);
    const formula = formulaFor(draft, periodId, targetType(draft, target), target?.dept);
    const participation = {
      participationPercent: formula.participation?.percent ?? policyFor(draft, periodId).participationPercent,
      participationPlusOne: formula.participation?.plusOne ?? policyFor(draft, periodId).participationPlusOne,
    };
    return sectionStats(draft, periodId, s.id, participation);
  }).filter((st) => st.required && !st.valid);
  const kind = final ? 'invalidated' : 'participation';
  const tag = final ? `thr|${periodId}` : `part|${periodId}|${day}`;
  const line = (st) => `${st.section.code} (${st.section.subject}) – ${userById(draft, st.section.facultyId)?.name}: ${st.responded} of ${st.required} answered, ${st.needed} needed`;
  for (const st of low) {
    const s = st.section;
    notify(draft, {
      key: final ? `thr|${periodId}|${s.id}` : `${tag}|${s.id}`, userId: s.facultyId, kind,
      text: final
        ? `Student evaluation for ${s.code} (${s.subject}) in ${p.name} is excluded from your result: only ${st.responded} of ${st.required} students answered, and at least ${st.needed} (half of the class plus one) were needed.`
        : `Only ${st.responded} of ${st.required} students in ${s.code} (${s.subject}) have answered the evaluation for ${p.name}. At least ${st.needed} (half of the class plus one) are needed by ${fmtDate(p.deadline)}, or this class won't count. Please remind your students.`,
    });
  }
  const byDept = {};
  for (const st of low) (byDept[st.section.dept] ||= []).push(st);
  for (const [dept, list] of Object.entries(byDept)) {
    for (const h of deptHeads(draft, dept)) {
      notify(draft, {
        key: `${tag}|dept|${dept}|${h.id}`, userId: h.id, kind,
        text: `${final ? `${p.name} was closed. These classes in your department are excluded` : `${list.length} class(es) in your department do not have enough answers yet for ${p.name} (half of the class plus one)`}: ${list.map(line).join('; ')}.`,
      });
    }
  }
  if (low.length) {
    for (const h of hrUsers(draft)) {
      notify(draft, {
        key: `${tag}|hr|${h.id}`, userId: h.id, kind,
        text: `${p.name}: ${low.length} class(es) ${final ? 'were excluded because' : 'do not have enough answers yet:'} fewer than half of the class plus one answered. ${low.slice(0, 5).map(line).join('; ')}${low.length > 5 ? `; and ${low.length - 5} more` : ''}.`,
      });
    }
  }
  return low.length;
}
/** Final check when a period is closed (also used for the sample data). */
export function runThresholdCheck(draft, periodId) {
  const n = participationNotices(draft, periodId, true);
  periodById(draft, periodId).thresholdChecked = true;
  return n;
}
/** Progress warning while the period is open. */
export const participationAlerts = (draft, periodId) => participationNotices(draft, periodId, false);

// ---------- FR10: reminders to evaluators, alerts to their department and HR ----------
export function sendReminders(draft, periodId) {
  const p = periodById(draft, periodId);
  const day = today();
  const pending = draft.tasks.filter((x) => x.periodId === periodId && !x.response);
  const overdue = new Date(p.deadline + 'T23:59:59') < new Date();
  // one reminder per evaluator per day, however many evaluations they still have
  const byEvaluator = {};
  for (const t of pending) (byEvaluator[t.evaluatorId] ||= []).push(t);
  let sent = 0;
  for (const [evId, list] of Object.entries(byEvaluator)) {
    if (!active(userById(draft, evId))) continue;
    const names = [...new Set(list.map((t) => userById(draft, t.targetId)?.name))];
    if (notify(draft, {
      key: `rem|${periodId}|${evId}|${day}`, userId: evId, kind: overdue ? 'overdue' : 'reminder',
      text: `${overdue ? 'OVERDUE' : 'Reminder'}: you have ${list.length} evaluation(s) not yet submitted for ${p.name} (${names.slice(0, 3).join(', ')}${names.length > 3 ? ', …' : ''}). ${overdue ? 'The deadline has passed' : `Deadline: ${fmtDate(p.deadline)}`}.`,
    })) sent++;
  }
  // department alert: pending evaluations by the department's people
  const byDept = {};
  for (const t of pending) {
    const ev = userById(draft, t.evaluatorId);
    if (!active(ev) || !ev.dept) continue;
    const d = (byDept[ev.dept] ||= { staff: 0, students: 0 });
    if (t.group === 'ST') d.students++; else d.staff++;
  }
  for (const [dept, c] of Object.entries(byDept)) {
    for (const h of deptHeads(draft, dept)) {
      notify(draft, {
        key: `remdept|${periodId}|${dept}|${h.id}|${day}`, userId: h.id, kind: overdue ? 'overdue' : 'reminder',
        text: `${p.name}: in your department, ${c.staff} evaluation(s) by personnel and ${c.students} by students are still not submitted. ${overdue ? 'The deadline has passed.' : `Deadline: ${fmtDate(p.deadline)}.`}`,
      });
    }
  }
  const total = draft.tasks.filter((x) => x.periodId === periodId).length;
  if (pending.length) {
    for (const h of hrUsers(draft)) {
      notify(draft, {
        key: `remhr|${periodId}|${h.id}|${day}`, userId: h.id, kind: overdue ? 'overdue' : 'reminder',
        text: `${p.name}: ${pending.length} of ${total} evaluations are still not submitted. ${overdue ? 'The deadline has passed: close the period when ready.' : `Deadline: ${fmtDate(p.deadline)}.`}`,
      });
    }
  }
  return sent;
}

/**
 * FR10: automatic reminders. Runs at most once a day for each open period, from REMIND_DAYS
 * before the deadline (and every day after it until HR closes the period).
 * Returns the number of periods processed (0 = nothing to do).
 */
export function runDailyAutomation(draft) {
  const day = today();
  let ran = 0;
  for (const p of draft.periods.filter((x) => x.status === 'open')) {
    if (p.lastAuto === day) continue;
    const daysLeft = Math.round((new Date(p.deadline + 'T00:00:00') - new Date(day + 'T00:00:00')) / 86400000);
    if (daysLeft > REMIND_DAYS) continue;
    sendReminders(draft, p.id);
    participationAlerts(draft, p.id);
    p.lastAuto = day;
    ran++;
  }
  return ran;
}

// ---------- visibility (results hidden until released) ----------
export function stageAtLeast(period, stage) {
  return STAGES.indexOf(period.releaseStage) >= STAGES.indexOf(stage);
}
export function canSeeAll(user, period) {
  if (user.role === 'HR') return true;
  if (user.role === 'DIR') return stageAtLeast(period, 'dir');
  return false;
}
/** NFR6: own results only after Vice President approval and release to faculty. */
export function canSeeOwn(user, period) {
  return stageAtLeast(period, 'faculty') && isEvaluatee(user);
}
/** FR16: deans/principals see their department's results once released to faculty. */
export function canSeeDept(user, period) {
  return isResultHead(user) && stageAtLeast(period, 'faculty');
}
export const canSeeComments = canSeeAll;

/** FR17: VPs who still have to approve a period before it can go to faculty. */
export function pendingApprovals(db, period) {
  const done = new Set((period.approvals || []).map((a) => a.userId));
  const vps = directors(db);
  const waiting = vps.filter((u) => !done.has(u.id));
  // policy: every VP, any one VP, or a set number of VPs (so one VP on leave can't block every result)
  const pol = policyFor(db, period.id);
  const needed = pol.approvalMode === 'any' ? 1 : pol.approvalMode === 'count' ? Math.min(Math.max(1, Number(pol.approvalCount) || 1), vps.length || 1) : vps.length;
  return done.size >= needed && vps.length ? [] : waiting;
}
/** How many VP approvals the period needs, in words (for the screens). */
export function approvalRuleText(db, period) {
  const pol = policyFor(db, period?.id);
  return pol.approvalMode === 'any' ? 'any one VP' : pol.approvalMode === 'count' ? `at least ${pol.approvalCount} VP${pol.approvalCount > 1 ? 's' : ''}` : 'every VP';
}

/* ---------- comments: UB's supervisor forms have two boxes ---------- */
/**
 * The Dean/Principal and AP/PC/SH forms for faculty end with two boxes: "Employee's personal and
 * professional development plan" and "Areas to be improved by the employee". Both are kept in the one
 * (encrypted) comment as {"plan","improve"}; other forms keep a plain comment.
 */
export const hasPlanBoxes = (group, tt) => ['DEAN', 'CHAIR', 'PRIN', 'APRIN', 'SHEAD'].includes(group) && tt !== 'DEAN';
export const packComment = (plan = '', improve = '') => (plan.trim() || improve.trim() ? JSON.stringify({ plan: plan.trim(), improve: improve.trim() }) : '');
/** A stored comment as { plan, improve } (two boxes) or { text } (one box). */
export function commentParts(c) {
  if (!c) return null;
  if (typeof c === 'string' && c.startsWith('{"plan"')) {
    try { const o = JSON.parse(c); return { plan: o.plan || '', improve: o.improve || '' }; } catch { /* plain text */ }
  }
  return { text: String(c) };
}
