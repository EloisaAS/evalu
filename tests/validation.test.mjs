// Validation test suite (Objective 3): the panel's demonstration scenarios, run automatically.
// Each case has an ID, the requirement it checks, the expected result and the ACTUAL result measured now.
// Run:  npm run test:validation   ->  writes docs/test-report.md (and exits with an error if any case fails)
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evalu-validation-'));
process.env.EVALU_DATA_DIR = dir;
const L = await import('../src/lib/logic.js');
const { handleApi } = await import('../server/api.js');
const { sql } = await import('../server/db.js');

const results = [];
/** Record one test case. check() returns the actual value; pass = it equals expected (or the predicate). */
async function tc(id, req, scenario, expected, check, ok = (a) => JSON.stringify(a) === JSON.stringify(expected)) {
  let actual, pass;
  try { actual = await check(); pass = !!ok(actual); } catch (e) { actual = `ERROR: ${e.message}`; pass = false; }
  results.push({ id, req, scenario, expected: typeof expected === 'string' ? expected : JSON.stringify(expected), actual: typeof actual === 'string' ? actual : JSON.stringify(actual), pass });
}

/* ---------------- Part A: computation rules on controlled data ---------------- */
/** A college teacher with one class of `students`, `answered` of them answering with `st`; Dean and Chair optional. */
function scenario({ students = 40, answered = 21, st = 3.5, dean = 3.6, chair = 3.4, policy = null } = {}) {
  const rules = { COLLEGE_FACULTY: { ST: 40, DEAN: 40, CHAIR: 20 } };
  const db = { departments: [{ id: 'SIT', name: 'SIT', kind: 'college' }], users: [], sections: [], tasks: [], instruments: [], criteria: [], rules, policies: [],
    periods: [{ id: 'P', name: 'Test period', status: 'closed', releaseStage: 'hr', rules, policy, approvals: [] }] };
  const u = (id, role, position) => db.users.push({ id, name: id, role, position, dept: 'SIT', active: true });
  u('T', 'TP', 'faculty'); u('D', 'TP', 'dean'); u('C', 'TP', 'chair');
  const sec = { id: 'S', code: 'SEC', subject: 'Subject', facultyId: 'T', dept: 'SIT', studentIds: [] };
  db.sections.push(sec);
  const resp = (v) => ({ answers: { q: v }, weights: { q: 1 }, comment: null, submittedAt: '2026-11-01' });
  for (let i = 0; i < students; i++) {
    u(`s${i}`, 'ST', 'student'); sec.studentIds.push(`s${i}`);
    db.tasks.push({ id: `t${i}`, periodId: 'P', evaluatorId: `s${i}`, targetId: 'T', group: 'ST', sectionId: 'S', response: i < answered ? resp(st) : null });
  }
  db.tasks.push({ id: 'td', periodId: 'P', evaluatorId: 'D', targetId: 'T', group: 'DEAN', response: dean == null ? null : resp(dean) });
  db.tasks.push({ id: 'tc', periodId: 'P', evaluatorId: 'C', targetId: 'T', group: 'CHAIR', response: chair == null ? null : resp(chair) });
  return db;
}
const counts = (o) => L.sectionStats(scenario(o), 'P', 'S').valid;
const final = (o) => L.computeTarget(scenario(o), 'P', 'T');

await tc('TC-01', 'FR11 participation', '40 students, 20 answered (exactly half)', 'class excluded', () => (counts({ students: 40, answered: 20 }) ? 'class counted' : 'class excluded'));
await tc('TC-02', 'FR11 participation', '40 students, 21 answered (half + 1)', 'class counted', () => (counts({ students: 40, answered: 21 }) ? 'class counted' : 'class excluded'));
await tc('TC-03', 'FR11 participation', '41 students: answers needed', 21, () => L.neededResponses(41));
await tc('TC-04', 'FR11 participation', '41 students, 20 answered', 'class excluded', () => (counts({ students: 41, answered: 20 }) ? 'class counted' : 'class excluded'));
await tc('TC-05', 'FR11 participation', 'Even and odd sizes 1-6: answers needed', [1, 2, 2, 3, 3, 4], () => [1, 2, 3, 4, 5, 6].map((n) => L.neededResponses(n)));
await tc('TC-06', 'Policy (FR11)', 'HR changes the rule to 60% + 1: 40 students need', 25, () => L.neededResponses(40, { ...L.DEFAULT_POLICY, participationPercent: 60 }));
await tc('TC-07', 'FR13 weighted score', 'Students 3.50 (40%), Dean 3.60 (40%), Chair 3.40 (20%)', { final: 3.52, status: 'complete' }, () => { const r = final({}); return { final: r.final, status: r.status }; });
await tc('TC-08', 'FR13 re-weighting', 'Dean did not evaluate: Students 3.50, Chair 3.40 over 60%', { final: 3.47, status: 'reweighted', basis: 60 }, () => { const r = final({ dean: null }); return { final: r.final, status: r.status, basis: r.basis }; });
await tc('TC-09', 'FR11+FR13', 'Class below half + 1: students drop out, Dean + Chair over 60%', { final: 3.53, status: 'reweighted', basis: 60 }, () => { const r = final({ answered: 20 }); return { final: r.final, status: r.status, basis: r.basis }; });
await tc('TC-10', 'Policy (FR13)', 'HR policy "no final rating while a group is missing", Dean missing', { final: null, status: 'incomplete' }, () => { const r = final({ dean: null, policy: { ...L.DEFAULT_POLICY, missingGroup: 'incomplete' } }); return { final: r.final, status: r.status }; });
await tc('TC-11', 'FR13 rounding', 'Rounding to 2 decimals, then 3 decimals (policy)', [3.47, 3.467], () => [final({ dean: null }).final, final({ dean: null, policy: { ...L.DEFAULT_POLICY, decimals: 3 } }).final]);
await tc('TC-12', 'Rating bands', 'Interpretation of 3.51 / 3.50 / 3.00 / 2.99 / 2.50 / 2.49', ['Outstanding', 'Satisfactory', 'Satisfactory', 'Fair', 'Fair', 'Poor'], () => [3.51, 3.5, 3.0, 2.99, 2.5, 2.49].map((x) => L.interpretation(x)));
await tc('TC-13', 'Policy (bands)', 'HR raises Outstanding to 3.60: 3.55 becomes', 'Satisfactory', () => L.interpretation(3.55, false, { ...L.DEFAULT_POLICY, bands: [3.6, 3.0, 2.5] }));
await tc('TC-14', 'FR19 low items', 'Item mean 2.90 with cutoff 3.00, item mean 3.00', [true, false], () => [2.9, 3.0].map((m) => L.itemStats([{ response: { answers: { q: m }, weights: { q: 1 } } }])[0].low));

/* ---------------- Part B: the running system (API, database, access control) ---------------- */
const server = http.createServer(async (req, res) => { if (!(await handleApi(req, res))) { res.writeHead(404); res.end(); } });
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;
async function call(p, { body, cookie } = {}) {
  const res = await fetch(base + p, { method: body ? 'POST' : 'GET', headers: { ...(body && { 'Content-Type': 'application/json' }), ...(cookie && { Cookie: cookie }) }, body: body && JSON.stringify(body) });
  return { status: res.status, data: await res.json(), setCookie: res.headers.get('set-cookie') };
}
async function login(u, p = 'demo1234') { const r = await call('/api/auth/login', { body: { username: u, password: p } }); assert.equal(r.status, 200, `login ${u}`); return r.setCookie.split(';')[0]; }
const act = (c, n, a = {}) => call(`/api/actions/${n}`, { body: a, cookie: c });

try {
  const hr = await login('hr'), vp = await login('vp'), fac = await login('fac_a1'), student = await login('st_a10');

  // RBAC / NFR5
  await tc('TC-15', 'FR2 RBAC', 'A student tries an HR action (create an account)', 'HTTP 403', async () => `HTTP ${(await act(student, 'createUser', { name: 'X', username: 'xxx', email: 'xxx@ubaguio.edu', role: 'HR', position: 'hr' })).status}`);
  await tc('TC-16', 'FR2 RBAC', 'A teacher opens the data: other teachers\' answers included?', 'none', async () => {
    const d = (await call('/api/data', { cookie: fac })).data; const me = d.users.find((u) => u.name === 'Faculty A1').id;
    return d.tasks.some((t) => t.targetId !== me && t.evaluatorId !== me && t.response && !t.response.redacted) ? 'other answers visible' : 'none';
  });
  await tc('TC-17', 'NFR6 release', 'Teacher\'s own results for a period still with the VPs (not released)', 'not visible', async () => {
    const d = (await call('/api/data', { cookie: fac })).data; const me = d.users.find((u) => u.name === 'Faculty A1').id;
    return d.tasks.some((t) => t.periodId === 'p3' && t.targetId === me && t.response && !t.response.redacted) ? 'visible' : 'not visible';
  });
  await tc('TC-18', 'NFR5 anonymity', 'A teacher\'s released results: evaluator names included?', 'no names', async () => {
    const d = (await call('/api/data', { cookie: fac })).data; const me = d.users.find((u) => u.name === 'Faculty A1').id;
    return d.tasks.filter((t) => t.targetId === me && t.response && !t.response.redacted).every((t) => t.evaluatorId === null && t.response.submittedAt == null || t.group !== 'ST' && t.evaluatorId === null) ? 'no names' : 'names visible';
  });

  // FR17 governance
  await tc('TC-19', 'FR17 release order', 'HR releases to faculty before the VP approved', 'HTTP 409 (blocked)', async () => `HTTP ${(await act(hr, 'releaseNext', { periodId: 'p3' })).status}${(await act(hr, 'releaseNext', { periodId: 'p3' })).status === 409 ? ' (blocked)' : ''}`);
  await tc('TC-20', 'FR17 governance', 'VP returns the results to HR with a reason', { stage: 'hr', approvals: 0, hrNotified: true }, async () => {
    await act(vp, 'returnToHR', { periodId: 'p3', reason: 'Dean ratings for SIT look incomplete' });
    const p = sql.prepare("SELECT release_stage, approvals FROM periods WHERE id='p3'").get();
    const n = sql.prepare("SELECT count(*) n FROM notifications WHERE user_id='hr' AND text LIKE '%returned the results%'").get().n;
    return { stage: p.release_stage, approvals: p.approvals ? JSON.parse(p.approvals).length : 0, hrNotified: n > 0 };
  });
  await tc('TC-21', 'FR17 release order', 'HR sends again, VP approves, HR releases', 'HTTP 200 released', async () => {
    await act(hr, 'releaseNext', { periodId: 'p3' }); await act(vp, 'approveRelease', { periodId: 'p3' });
    const r = await act(hr, 'releaseNext', { periodId: 'p3' }); return `HTTP ${r.status} ${r.data.result?.stage === 'faculty' ? 'released' : ''}`.trim();
  });

  // Policy versioning (dynamic rules without code changes)
  await tc('TC-22', 'Policy versioning', 'HR changes the bands; a closed period keeps its rules, an open one follows', { closed: 3.51, open: 3.6, version: 1 }, async () => {
    const r = await act(hr, 'setPolicy', { policy: { ...L.DEFAULT_POLICY, bands: [3.6, 3.0, 2.5] }, reason: 'Validation test: new HRMC bands' });
    const closed = JSON.parse(sql.prepare("SELECT policy FROM periods WHERE id='p1'").get().policy).bands[0];
    const open = JSON.parse(sql.prepare("SELECT policy FROM periods WHERE id='p4'").get().policy).bands[0];
    return { closed, open, version: r.data.result?.version };
  });
  await tc('TC-23', 'Policy governance', 'A policy change without a reason', 'HTTP 400', async () => `HTTP ${(await act(hr, 'setPolicy', { policy: { ...L.DEFAULT_POLICY, lowItem: 2.8 }, reason: '' })).status}`);
  await tc('TC-24', 'Confidentiality', 'Minimum students for comments set to 50: teacher sees student comments?', 'hidden', async () => {
    await act(hr, 'setPolicy', { policy: { ...L.currentPolicy({ policies: [{ version: 1, policy: { ...L.DEFAULT_POLICY, bands: [3.6, 3.0, 2.5] } }] }), minAnonymity: 50 }, reason: 'Validation test: anonymity' });
    // p4 is open, so it follows the new policy; check p3 (now released, closed) keeps its own and p4's rule applies to new results
    const per = sql.prepare("SELECT policy FROM periods WHERE id='p4'").get();
    const d = (await call('/api/data', { cookie: fac })).data;
    const st = d.tasks.filter((t) => t.group === 'ST' && t.response && !t.response.redacted && t.periodId === 'p4');
    return JSON.parse(per.policy).minAnonymity === 50 && st.every((t) => t.response.comment == null) ? 'hidden' : 'shown';
  });

  // FR4 dynamic forms
  await tc('TC-25', 'FR4 form versioning', 'A form already answered: revise it, old answers keep their version', { newVersion: 2, oldAnswersUnchanged: true }, async () => {
    const d = (await call('/api/data', { cookie: hr })).data;
    const used = d.tasks.find((t) => t.response?.instrumentId)?.response.instrumentId;
    const before = sql.prepare('SELECT count(*) n FROM responses WHERE instrument_id = ?').get(used).n;
    const r = await act(hr, 'reviseForm', { instrumentId: used });
    const after = sql.prepare('SELECT count(*) n FROM responses WHERE instrument_id = ?').get(used).n;
    const v = sql.prepare('SELECT version FROM instruments WHERE id = ?').get(r.data.result.id).version;
    return { newVersion: v, oldAnswersUnchanged: before === after };
  }, (a) => a.newVersion >= 2 && a.oldAnswersUnchanged);

  // Data import validation
  const csv = ['section code,subject,teacher email,student ID,student name,student UB email',
    'VT-1,Validation Subject,fac_a1@ubaguio.edu,99990001,Val One,99990001@s.ubaguio.edu',
    'VT-1,Validation Subject,fac_a1@ubaguio.edu,99990001,Val One,99990001@s.ubaguio.edu',
    'VT-1,Validation Subject,fac_a1@ubaguio.edu,99990002,Val Two,99990002@gmail.com',
    'VT-1,,fac_a1@ubaguio.edu,99990003,Val Three,99990003@s.ubaguio.edu'].join('\n');
  await tc('TC-26', 'Data validation', 'Check a file with 1 duplicate, 1 non-UB email and 1 missing subject', { duplicates: 1, errors: 2, savedNothing: true }, async () => {
    const before = sql.prepare('SELECT count(*) n FROM sections').get().n;
    const r = (await act(hr, 'importClassList', { csv, dept: 'A', preview: true })).data.result;
    return { duplicates: r.duplicates, errors: r.errorCount, savedNothing: sql.prepare('SELECT count(*) n FROM sections').get().n === before };
  });
  await tc('TC-27', 'Data validation', 'Import the same file: good rows saved, bad rows skipped', { classes: 1, students: 1, skipped: 2 }, async () => {
    const r = (await act(hr, 'importClassList', { csv, dept: 'A' })).data.result;
    return { classes: r.created, students: r.accounts, skipped: r.errorCount };
  });

  // Evaluation integrity
  const sd = (await call('/api/data', { cookie: student })).data;
  const openPeriod = sd.periods.find((x) => x.status === 'open');
  const open = sd.tasks.find((t) => t.periodId === openPeriod.id && !t.response);
  const ins = open && L.formForTask(sd, open);
  const answers = ins ? Object.fromEntries(ins.items.map((it) => [it.criterionId, 3])) : {};
  await tc('TC-28', 'Deadline', 'A student submits after the deadline has passed', 'HTTP 409 (rejected)', async () => {
    const old = openPeriod.deadline;
    await act(hr, 'setPeriodDeadline', { periodId: openPeriod.id, deadline: '2020-01-01' });
    const r = await act(student, 'submitEvaluation', { taskId: open.id, answers, comment: '' });
    await act(hr, 'setPeriodDeadline', { periodId: openPeriod.id, deadline: old });
    return `HTTP ${r.status}${r.status === 409 ? ' (rejected)' : ''}`;
  });
  await tc('TC-29', 'Duplicate submission', 'A student submits the same evaluation twice', ['HTTP 200', 'HTTP 409'], async () => {
    const a = await act(student, 'submitEvaluation', { taskId: open.id, answers, comment: 'Validation comment: clear lessons' });
    const b = await act(student, 'submitEvaluation', { taskId: open.id, answers, comment: '' });
    return [`HTTP ${a.status}`, `HTTP ${b.status}`];
  });
  await tc('TC-30', 'Encryption (NFR)', 'The comment as stored in the database file', 'encrypted (no readable text)', () => {
    const row = sql.prepare('SELECT comment FROM responses WHERE task_id = ?').get(open.id);
    return row?.comment && !row.comment.includes('clear lessons') ? 'encrypted (no readable text)' : 'readable';
  });

  // FR20 audit
  await tc('TC-31', 'FR20 audit trail', 'Policy change is logged with before -> after values and reason', 'logged', () => {
    const row = sql.prepare("SELECT detail FROM audit_log WHERE action='setPolicy' ORDER BY id LIMIT 1").get();
    return row && row.detail.includes('→') && row.detail.includes('reason:') ? 'logged' : 'missing';
  });
  await tc('TC-32', 'FR20 audit integrity', 'Verify the audit log hash chain', 'intact', async () => ((await call('/api/audit/verify', { cookie: hr })).data.ok ? 'intact' : 'broken'));
  await tc('TC-33', 'FR20 audit integrity', 'Someone edits an audit entry directly in the database', 'tampering detected at that entry', async () => {
    const id = sql.prepare("SELECT id FROM audit_log WHERE action='setPolicy' ORDER BY id LIMIT 1").get().id;
    sql.prepare("UPDATE audit_log SET detail = 'edited by hand' WHERE id = ?").run(id);
    const r = (await call('/api/audit/verify', { cookie: hr })).data;
    return !r.ok && r.firstBad.id === id ? 'tampering detected at that entry' : JSON.stringify(r);
  });
  /* ---------------- Part C: dynamic computation engine (formulas as data) ---------------- */
  const F = await import('../src/lib/formula.js');
  const base = { method: 'WEIGHTED_AVERAGE', components: [{ group: 'ST', weight: 40, aggregation: 'SECTION_AVERAGE' }, { group: 'DEAN', weight: 40, aggregation: 'AVERAGE' }, { group: 'CHAIR', weight: 20, aggregation: 'AVERAGE' }], expression: '', missing: 'REWEIGHT', minGroups: 1, rounding: { decimals: 2, method: 'HALF_UP' } };
  const S = { ST: 4.3, DEAN: 4.5, CHAIR: 4.1 };
  const w = (a, b, c) => ({ ...base, components: [{ ...base.components[0], weight: a }, { ...base.components[1], weight: b }, { ...base.components[2], weight: c }] });
  await tc('TC-34', 'Dynamic formula: weights', 'Same answers, 40/40/20 then 30/50/20 (configuration only)', [4.34, 4.36], () => [F.computeFinal(w(40, 40, 20), S).final, F.computeFinal(w(30, 50, 20), S).final]);
  await tc('TC-35', 'Dynamic formula: method', 'Switch from weighted to simple average (S + D + P) / 3', 4.3, () => F.computeFinal({ ...base, method: 'AVERAGE' }, S).final);
  await tc('TC-36', 'Dynamic formula: missing group', 'Dean missing: re-weight / invalidate / count as zero / use the others\' average', [4.23, null, 2.54, 4.22], () => ['REWEIGHT', 'INVALIDATE', 'ZERO', 'SUBSTITUTE_MEAN'].map((m) => F.computeFinal({ ...base, missing: m }, { ...S, DEAN: null }).final));
  await tc('TC-37', 'Dynamic formula: custom expression', 'Expression 0.3*ST + 0.5*DEAN + 0.2*CHAIR', 4.36, () => F.computeFinal({ ...base, method: 'CUSTOM', missing: 'INVALIDATE', expression: '0.3*ST + 0.5*DEAN + 0.2*CHAIR' }, S).final);
  await tc('TC-38', 'Security: no code execution', 'Expressions with code: process.exit(), constructor(1), ST.constructor, __proto__', 'all rejected', () => (['process.exit()', 'constructor(1)', 'ST.constructor', '__proto__', 'require("fs")'].every((x) => { try { F.parseExpression(x, ['ST']); return false; } catch { return true; } }) ? 'all rejected' : 'one was accepted'));
  await tc('TC-39', 'Dynamic formula: rounding', '3.465 half up / half even, 3.469 down, 3.461 up; 3.4567 to 3 decimals', [3.47, 3.46, 3.46, 3.47, 3.457], () => [F.roundBy(3.465, 2, 'HALF_UP'), F.roundBy(3.465, 2, 'HALF_EVEN'), F.roundBy(3.469, 2, 'DOWN'), F.roundBy(3.461, 2, 'UP'), F.roundBy(3.4567, 3, 'HALF_UP')]);
  await tc('TC-40', 'Formula validation', 'Weights total 90%; a group with no form for this category', 2, () => F.validateFormula({ ...w(40, 30, 20) }, { allowedGroups: ['ST', 'DEAN', 'CHAIR'] }).length + F.validateFormula({ ...base, components: [...base.components.slice(0, 2), { group: 'NTPHEAD', weight: 20, aggregation: 'AVERAGE' }] }, { allowedGroups: ['ST', 'DEAN', 'CHAIR'] }).length, (n) => n === 2);

  const before = (await call('/api/data', { cookie: hr })).data;
  const p1Before = L.computeTarget(before, 'p1', 'fac_a1').final;
  let fxId;
  await tc('TC-41', 'Formula approval workflow', 'Draft → activate without approval → submit without basis → HR approves own → VP approves → HR activates', ['409', '400', '403', '200', '200'], async () => {
    const d = await act(hr, 'saveFormulaDraft', { targetType: 'COLLEGE_FACULTY', config: { ...base, name: 'College faculty (simple average)', method: 'AVERAGE' } });
    fxId = d.data.result.id;
    const a = (await act(hr, 'activateFormula', { id: fxId })).status;
    const b = (await act(hr, 'submitFormula', { id: fxId, basis: '' })).status;
    await act(hr, 'submitFormula', { id: fxId, basis: 'Validation test: committee resolution no. 3' });
    const c = (await act(hr, 'approveFormula', { id: fxId })).status;
    const e = (await act(vp, 'approveFormula', { id: fxId })).status;
    const f = (await act(hr, 'activateFormula', { id: fxId })).status;
    return [a, b, c, e, f].map(String);
  });
  await tc('TC-42', 'Formula versioning', 'After activating the new formula: a closed period keeps its rating; the open period with answers keeps its formula', { closedUnchanged: true, openKept: true }, async () => {
    const after = (await call('/api/data', { cookie: hr })).data;
    const open = after.periods.find((x) => x.status === 'open');
    return { closedUnchanged: L.computeTarget(after, 'p1', 'fac_a1').final === p1Before, openKept: !Object.values(open.formulas || {}).some((x) => x.id === fxId) };
  });
  await tc('TC-43', 'Formula versioning', 'A period created after activation uses the new version', 'new version', async () => {
    const r = await act(hr, 'createPeriod', { name: 'AY 2027-28 Term 1 (validation)', deadline: '2099-12-31' });
    const d = (await call('/api/data', { cookie: hr })).data;
    return d.periods.find((x) => x.id === r.data.result.id).formulas?.COLLEGE_FACULTY?.id === fxId ? 'new version' : 'old version';
  });
  await tc('TC-44', 'Formula governance', 'Approved/active formula edited directly; weights page edit of a formula category', ['HTTP 409', 'HTTP 409'], async () => [
    `HTTP ${(await act(hr, 'saveFormulaDraft', { id: fxId, config: base })).status}`,
    `HTTP ${(await act(hr, 'setGroupWeight', { targetType: 'COLLEGE_FACULTY', group: 'ST', weight: 50 })).status}`,
  ]);
  await tc('TC-45', 'Stored results', 'Close the open period: every result stored with formula version; stored = recomputed', { stored: true, allMatch: true }, async () => {
    const d0 = (await call('/api/data', { cookie: hr })).data;
    const open = d0.periods.find((x) => x.status === 'open' && !/validation/.test(x.name));
    await act(hr, 'closePeriod', { periodId: open.id });
    const d = (await call('/api/data', { cookie: hr })).data;
    const rows = d.results.filter((r) => r.periodId === open.id);
    return { stored: rows.length > 0 && rows.every((r) => r.data.formula && 'version' in r.data.formula && Array.isArray(r.data.steps)), allMatch: rows.every((r) => L.computeTarget(d, open.id, r.targetId).final === r.data.final) };
  });
  await tc('TC-46', 'Formula condition', 'A department-only formula (Business, SBAA) applies to its teachers only', { sbaa: 'department formula', sit: 'general formula' }, async () => {
    const x = (await act(hr, 'saveFormulaDraft', { targetType: 'COLLEGE_FACULTY', dept: 'B', config: { ...w(50, 30, 20), name: 'College faculty (SBAA)' } })).data.result.id;
    await act(hr, 'submitFormula', { id: x, basis: 'Validation test: SBAA policy' }); await act(vp, 'approveFormula', { id: x }); await act(hr, 'activateFormula', { id: x });
    const r = await act(hr, 'createPeriod', { name: 'AY 2027-28 Term 2 (validation)', deadline: '2099-12-31' });
    const d = (await call('/api/data', { cookie: hr })).data;
    const fB = L.formulaFor(d, r.data.result.id, 'COLLEGE_FACULTY', 'B'), fA = L.formulaFor(d, r.data.result.id, 'COLLEGE_FACULTY', 'A');
    return { sbaa: fB.id === x ? 'department formula' : 'other', sit: fA.id === fxId ? 'general formula' : 'other' };
  });
  await tc('TC-47', 'No built-in formula', 'HR makes College faculty 50% Students + 50% Dean (no Chair) and Basic Ed an equal average; the server restarts', { college: { ST: 50, DEAN: 50 }, basicEdUnchanged: true }, async () => {
    const { upgradeData } = await import('../server/upgrade.js');
    const db = structuredClone((await call('/api/data', { cookie: hr })).data);
    db.rules.COLLEGE_FACULTY = { ST: 50, DEAN: 50 };
    db.rules.BASICED_TEACHER = { ST: null, PRIN: null, APRIN: null, SHEAD: null };
    db.formulas = [...(db.formulas || []), { id: 'x1', key: 'COLLEGE_FACULTY', targetType: 'COLLEGE_FACULTY', status: 'active', version: 9, config: {}, meta: {} }, { id: 'x2', key: 'BASICED_TEACHER', targetType: 'BASICED_TEACHER', status: 'active', version: 1, config: {}, meta: {} }];
    upgradeData(db);
    return { college: db.rules.COLLEGE_FACULTY, basicEdUnchanged: Object.values(db.rules.BASICED_TEACHER).every((x) => x == null) };
  });
  await tc('TC-48', 'Blank formula', 'HR starts a blank formula and tries to send it without choosing anything', 'HTTP 400 (must choose method, groups and missing-group rule)', async () => {
    const r = await act(hr, 'saveFormulaDraft', { targetType: 'NTP_STAFF', config: { name: 'Blank', method: '', components: [], missing: '' } });
    const s = await act(hr, 'submitFormula', { id: r.data.result.id, basis: 'Validation test: blank formula' });
    return s.status === 400 && /method/i.test(s.data.error) && /group/i.test(s.data.error) ? 'HTTP 400 (must choose method, groups and missing-group rule)' : `HTTP ${s.status}: ${s.data.error}`;
  });
  /* ---------------- Part D: ideas from similar systems ---------------- */
  const C = await import('../src/lib/comments.js');
  const COMMENTS = ['Very clear explanation and approachable.', 'Always late and does not return our quizzes.', 'Magaling magturo pero minsan late.', 'Hindi malinaw ang paliwanag.', 'She is never late and always prepared.', 'N/A'];
  await tc('TC-49', 'Comment analysis (sentiment)', 'English, Filipino and Taglish comments, with "not/hindi" and "never late"', ['positive', 'negative', 'mixed', 'negative', 'positive', 'neutral'], () => COMMENTS.map((c) => C.analyzeComment(c).sentiment));
  await tc('TC-50', 'Comment analysis (topics, suggestions)', '"Please give feedback on our work sooner." / "The lessons are clear and well prepared."', [{ suggestion: true, topics: ['feedback'] }, { suggestion: false, topics: ['clarity', 'preparation'] }], () => ['Please give feedback on our work sooner.', 'The lessons are clear and well prepared.'].map((c) => { const a = C.analyzeComment(c); return { suggestion: a.suggestion, topics: a.topics }; }));
} finally {
  server.close();
}

/* ---------------- report ---------------- */
const passed = results.filter((r) => r.pass).length;
let commit = 'unknown'; try { commit = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim(); } catch { /* not a git checkout */ }
const md = [
  '# evalU validation test report',
  '',
  `Run: ${new Date().toISOString()} · Node ${process.version} · code version ${commit} · fresh test database with the sample data`,
  '',
  `**Result: ${passed} of ${results.length} test cases passed.**`,
  '',
  'Each case runs automatically (`npm run test:validation`). "Actual" is measured during this run, not written by hand.',
  'Part A checks the computation rules on controlled data; Part B runs the real server, database and access control.',
  '',
  '| ID | Requirement | Scenario | Expected | Actual | Result |',
  '|---|---|---|---|---|---|',
  ...results.map((r) => `| ${r.id} | ${r.req} | ${r.scenario} | ${r.expected} | ${r.actual} | ${r.pass ? 'PASS' : '**FAIL**'} |`),
  '',
  'Limits of this report: these are developer-run functional, security and integration tests on simulated data. They do not replace the stakeholder evaluation (ISO/IEC 25010 questionnaire) or confirmation of the rules by HRMC.',
  '',
].join('\n');
fs.mkdirSync('docs', { recursive: true });
fs.writeFileSync('docs/test-report.md', md);
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.id}  ${r.scenario}${r.pass ? '' : `\n      expected ${r.expected}\n      actual   ${r.actual}`}`);
console.log(`\n${passed}/${results.length} passed · report written to docs/test-report.md`);
try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* Windows keeps the database file open until exit */ }
process.exit(passed === results.length ? 0 : 1);
