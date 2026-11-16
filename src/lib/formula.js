// Dynamic evaluation computation engine.
//
// The final rating of a person is computed from a FORMULA stored as data (not written in the code):
//   { method, components: [{ group, weight, aggregation }], expression, missing, minGroups, rounding }
// HR encodes the formula the evaluation committee approved; this engine only knows how to run the
// supported operations. It never runs code typed by a user: custom expressions are parsed by the small
// calculator below, which understands numbers, group names, + - * / ( ) and avg(), min(), max() only.
//
// Shared by the server and the browser (the simulator runs the same engine HR sees).

export const METHODS = {
  WEIGHTED_AVERAGE: 'Give each group a percentage',
  AVERAGE: 'Count every group the same',
  CUSTOM: 'Write my own formula (advanced)',
};
export const AGGREGATIONS = {
  AVERAGE: 'Average of the evaluators',
  MEDIAN: 'Middle value (median)',
  SECTION_AVERAGE: 'Average per class, then average of the classes',
  POOLED: 'All students together',
};
// "Short words: explanation" (screens show the part before the colon)
export const MISSING_RULES = {
  REWEIGHT: 'Use only the groups that have a rating: their percentages are scaled up to 100%',
  INVALIDATE: 'No final rating yet: wait until every group has a rating',
  ZERO: 'Count it as 0: the final rating goes down',
  SUBSTITUTE_MEAN: 'Give it the average of the other groups: then compute as usual',
};
export const ROUNDING_METHODS = {
  HALF_UP: 'Normal rounding (3.465 → 3.47)',
  HALF_EVEN: "Banker's rounding (3.465 → 3.46)",
  DOWN: 'Always down (3.469 → 3.46)',
  UP: 'Always up (3.461 → 3.47)',
};

// Only the exact names in these lists are accepted (never built-in object names like 'constructor').
const has = (o, k) => typeof k === 'string' && Object.hasOwn(o, k);

/** Round with the formula's rounding method; immune to binary float noise (3.465 stays 3.465). */
export function roundBy(x, decimals = 2, method = 'HALF_UP') {
  if (x == null || !Number.isFinite(x)) return null;
  const f = 10 ** decimals;
  const scaled = Math.round(x * f * 1e6) / 1e6; // remove float noise first
  const floor = Math.floor(scaled), frac = +(scaled - floor).toFixed(6);
  let r;
  if (method === 'DOWN') r = floor;
  else if (method === 'UP') r = frac > 0 ? floor + 1 : floor;
  else if (method === 'HALF_EVEN') r = frac > 0.5 ? floor + 1 : frac < 0.5 ? floor : (floor % 2 === 0 ? floor : floor + 1);
  else r = frac >= 0.5 ? floor + 1 : floor;
  return r / f;
}

/* ---------------- safe expression calculator (no eval) ---------------- */
const FUNCS = {
  avg: (xs) => xs.reduce((a, b) => a + b, 0) / xs.length,
  min: (xs) => Math.min(...xs),
  max: (xs) => Math.max(...xs),
};
function tokenize(src) {
  const out = [];
  const re = /\s*(?:(\d+(?:\.\d+)?|\.\d+)|([A-Za-z_][A-Za-z_]*)|([-+*/(),]))/y;
  let i = 0;
  while (i < src.length) {
    if (/\s/.test(src[i])) { i++; continue; }
    re.lastIndex = i;
    const m = re.exec(src);
    if (!m) throw new Error(`Unexpected "${src[i]}" at position ${i + 1}. Use numbers, group names, + - * / ( ) and avg, min, max.`);
    if (m[1] !== undefined) out.push({ t: 'num', v: Number(m[1]) });
    else if (m[2] !== undefined) out.push({ t: 'id', v: m[2] });
    else out.push({ t: m[3] });
    i = re.lastIndex;
  }
  return out;
}
/** Parse an expression into a tree. Only the listed group names may be used as variables. */
export function parseExpression(src, allowedVars) {
  if (typeof src !== 'string' || !src.trim()) throw new Error('Write the expression, for example 0.4*ST + 0.4*DEAN + 0.2*CHAIR.');
  if (src.length > 300) throw new Error('The expression is too long (max 300 characters).');
  const toks = tokenize(src);
  const vars = new Set((allowedVars || []).map((v) => v.toUpperCase()));
  let p = 0;
  const peek = () => toks[p];
  const take = (t) => { if (peek()?.t !== t) throw new Error(`Expected "${t}"${peek() ? ` but found "${peek().v ?? peek().t}"` : ' at the end'}.`); return toks[p++]; };
  function primary() {
    const k = peek();
    if (!k) throw new Error('The expression ends too early.');
    if (k.t === 'num') { p++; return { op: 'num', v: k.v }; }
    if (k.t === '-') { p++; return { op: 'neg', a: primary() }; }
    if (k.t === '(') { p++; const e = expr(); take(')'); return e; }
    if (k.t === 'id') {
      p++;
      const name = k.v;
      if (peek()?.t === '(') {
        const fn = name.toLowerCase();
        if (!has(FUNCS, fn)) throw new Error(`Unknown function "${name}". Allowed: avg, min, max.`);
        take('(');
        const args = [expr()];
        while (peek()?.t === ',') { p++; args.push(expr()); }
        take(')');
        return { op: 'fn', fn, args };
      }
      const v = name.toUpperCase();
      if (!vars.has(v)) throw new Error(`"${name}" is not one of this formula's groups (${[...vars].join(', ') || 'none'}).`);
      return { op: 'var', v };
    }
    throw new Error(`Unexpected "${k.t}".`);
  }
  function term() {
    let a = primary();
    while (peek()?.t === '*' || peek()?.t === '/') { const o = toks[p++].t; a = { op: o, a, b: primary() }; }
    return a;
  }
  function expr() {
    let a = term();
    while (peek()?.t === '+' || peek()?.t === '-') { const o = toks[p++].t; a = { op: o, a, b: term() }; }
    return a;
  }
  const tree = expr();
  if (p < toks.length) throw new Error(`Unexpected "${toks[p].v ?? toks[p].t}" after the end of the expression.`);
  return tree;
}
/** Evaluate a parsed expression with group scores; null if a value is missing or a division by zero happens. */
export function evaluate(node, env) {
  switch (node.op) {
    case 'num': return node.v;
    case 'var': return has(env, node.v) ? env[node.v] ?? null : null;
    case 'neg': { const a = evaluate(node.a, env); return a == null ? null : -a; }
    case 'fn': { if (!has(FUNCS, node.fn)) return null; const xs = node.args.map((x) => evaluate(x, env)); return xs.some((x) => x == null) ? null : FUNCS[node.fn](xs); }
    default: {
      const a = evaluate(node.a, env), b = evaluate(node.b, env);
      if (a == null || b == null) return null;
      if (node.op === '+') return a + b;
      if (node.op === '-') return a - b;
      if (node.op === '*') return a * b;
      if (node.op === '/') return b === 0 ? null : a / b;
      return null;
    }
  }
}
export const expressionVars = (node, out = new Set()) => {
  if (!node) return out;
  if (node.op === 'var') out.add(node.v);
  for (const k of ['a', 'b']) if (node[k]) expressionVars(node[k], out);
  for (const x of node.args || []) expressionVars(x, out);
  return out;
};

/* ---------------- formulas ---------------- */
/**
 * The starting formula of a category before HR saves one: the starting percentages stored in the
 * database at setup (manuscript, Table 6). No formula is built into the program; HR replaces this one.
 */
export function defaultFormula(weights = {}, policy = {}) {
  return {
    name: 'Starting formula', version: 0, method: 'WEIGHTED_AVERAGE',
    components: Object.entries(weights).map(([group, weight]) => ({ group, weight: weight === '' ? null : weight, aggregation: group === 'ST' ? 'SECTION_AVERAGE' : 'AVERAGE' })),
    expression: '',
    missing: policy.missingGroup === 'incomplete' ? 'INVALIDATE' : 'REWEIGHT',
    minGroups: 1,
    rounding: { decimals: policy.decimals ?? 2, method: 'HALF_UP' },
  };
}

/** Problems that stop a formula from being submitted or used (empty list = valid). */
export function validateFormula(f, { allowedGroups = null, groupNames = {} } = {}) {
  const errs = [];
  if (!has(METHODS, f.method)) errs.push('Choose a computation method.');
  const comps = f.components || [];
  if (!comps.length) errs.push('Add at least one evaluator group.');
  const seen = new Set();
  for (const c of comps) {
    const label = groupNames[c.group] || c.group;
    if (seen.has(c.group)) errs.push(`${label} is listed twice.`);
    seen.add(c.group);
    if (allowedGroups && !allowedGroups.includes(c.group)) errs.push(`${label} has no evaluation form for this category, so nobody could be assigned to evaluate.`);
    if (!has(AGGREGATIONS, c.aggregation)) errs.push(`Choose how ${label}'s evaluators are combined.`);
    if (c.group !== 'ST' && ['SECTION_AVERAGE', 'POOLED'].includes(c.aggregation)) errs.push(`"${AGGREGATIONS[c.aggregation]}" is only for students.`);
    if (f.method === 'WEIGHTED_AVERAGE' && !(Number(c.weight) > 0)) errs.push(`${label} needs a weight above 0%.`);
  }
  if (f.method === 'WEIGHTED_AVERAGE') {
    const total = comps.reduce((a, c) => a + (Number(c.weight) || 0), 0);
    if (Math.abs(total - 100) > 1e-9) errs.push(`The weights add up to ${+total.toFixed(2)}%; they must add up to 100%.`);
  }
  if (f.method === 'CUSTOM') {
    try {
      const tree = parseExpression(f.expression, comps.map((c) => c.group));
      const used = expressionVars(tree);
      const unused = comps.filter((c) => !used.has(c.group));
      if (unused.length) errs.push(`The expression does not use: ${unused.map((c) => groupNames[c.group] || c.group).join(', ')}. Remove them from the groups or use them.`);
    } catch (e) { errs.push(`Expression: ${e.message}`); }
    if (f.missing === 'REWEIGHT') errs.push('Re-weighting is not defined for a custom expression; choose another missing-group rule.');
  }
  if (!has(MISSING_RULES, f.missing)) errs.push('Choose what happens when a group is missing.');
  const d = Number(f.rounding?.decimals);
  if (!Number.isInteger(d) || d < 0 || d > 4) errs.push('Decimal places must be 0 to 4.');
  if (!has(ROUNDING_METHODS, f.rounding?.method)) errs.push('Choose a rounding method.');
  const mg = Number(f.minGroups ?? 1);
  if (!Number.isInteger(mg) || mg < 1 || mg > Math.max(1, comps.length)) errs.push('The minimum number of groups must be between 1 and the number of groups.');
  return errs;
}

/**
 * Run a formula on the groups' scores.
 *   scores: { ST: 3.5, DEAN: null, CHAIR: 3.4 }   (null = no valid result from that group)
 * Returns { final, status, basis, breakdown, missing, steps } where status is
 * complete | reweighted | incomplete | weights-missing, and breakdown lists each group's
 * score, applied weight (share of the total) and contribution to the final rating.
 */
export function computeFinal(f, scores) {
  const comps = f.components || [];
  const groups = comps.map((c) => c.group);
  const missing = groups.filter((g) => scores[g] == null);
  const have = groups.filter((g) => scores[g] != null);
  const dec = Number(f.rounding?.decimals ?? 2), how = f.rounding?.method || 'HALF_UP';
  const out = (final, status, basis, breakdown, steps) => ({ final, status, basis, breakdown, missing, steps });

  if (f.method === 'WEIGHTED_AVERAGE' && comps.some((c) => c.weight == null || c.weight === '')) return out(null, 'weights-missing', null, [], ['Some weights are not set.']);
  if (!have.length) return out(null, 'incomplete', null, [], ['No group has a valid result yet.']);
  if (have.length < Number(f.minGroups || 1)) return out(null, 'incomplete', null, [], [`Only ${have.length} group(s) have a result; the formula needs at least ${f.minGroups}.`]);
  if (missing.length && f.missing === 'INVALIDATE') return out(null, 'incomplete', null, [], [`Missing: ${missing.join(', ')}. The formula gives no final rating while a group is missing.`]);

  const meanHave = have.reduce((a, g) => a + scores[g], 0) / have.length;
  const val = (g) => (scores[g] != null ? scores[g] : f.missing === 'ZERO' ? 0 : f.missing === 'SUBSTITUTE_MEAN' ? meanHave : null);
  const status = missing.length ? 'reweighted' : 'complete';
  const steps = [];

  if (f.method === 'CUSTOM') {
    const env = Object.fromEntries(groups.map((g) => [g, val(g)]));
    let raw;
    try { raw = evaluate(parseExpression(f.expression, groups), env); } catch (e) { return out(null, 'incomplete', null, [], [`Expression error: ${e.message}`]); }
    if (raw == null) return out(null, 'incomplete', null, [], ['The expression could not be computed (a value is missing or a division by zero).']);
    const breakdown = groups.map((g) => ({ group: g, score: scores[g], used: env[g], weight: null, share: null, contribution: null }));
    steps.push(`${f.expression} with ${groups.map((g) => `${g} = ${env[g] == null ? '—' : +env[g].toFixed(4)}`).join(', ')}`);
    steps.push(`= ${+raw.toFixed(6)} → rounded ${roundBy(raw, dec, how)}`);
    return out(roundBy(raw, dec, how), status, null, breakdown, steps);
  }

  // weighted or simple average: the groups that take part and their weights
  const w = (c) => (f.method === 'AVERAGE' ? 1 : Number(c.weight));
  const used = comps.filter((c) => (f.missing === 'REWEIGHT' ? scores[c.group] != null : true));
  const totalW = used.reduce((a, c) => a + w(c), 0);
  if (!totalW) return out(null, 'incomplete', null, [], ['The groups with a result have no weight.']);
  const breakdown = comps.map((c) => {
    const inIt = used.includes(c);
    const v = inIt ? val(c.group) : null;
    const share = inIt ? w(c) / totalW : 0;
    return { group: c.group, score: scores[c.group], used: v, weight: f.method === 'AVERAGE' ? null : Number(c.weight), share, contribution: inIt ? v * share : 0 };
  });
  const raw = breakdown.reduce((a, b) => a + (b.contribution || 0), 0);
  const basis = f.method === 'AVERAGE' ? null : used.reduce((a, c) => a + Number(c.weight), 0);
  steps.push(breakdown.filter((b) => b.share).map((b) => `${b.group} ${+b.used.toFixed(4)} × ${(b.share * 100).toFixed(2)}%`).join(' + ') + ` = ${+raw.toFixed(6)}`);
  if (missing.length) steps.push(`Missing ${missing.join(', ')}: ${MISSING_RULES[f.missing].split(':')[0].toLowerCase()}.`);
  steps.push(`Rounded (${how.toLowerCase().replace('_', ' ')}, ${dec} decimals): ${roundBy(raw, dec, how)}`);
  return out(roundBy(raw, dec, how), status, basis, breakdown, steps);
}

const andList = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);
/** The formula as a plain sentence: "Final rating = 40% Students + 40% Dean + 20% Program Chair". */
export function formulaWords(f, names = {}) {
  const n = (g) => names[g] || g;
  const comps = f.components || [];
  if (f.method === 'CUSTOM') return `Final rating = ${comps.reduce((t, c) => t.replace(new RegExp(`\\b${c.group}\\b`, 'gi'), n(c.group)), f.expression || '…')}`;
  if (f.method === 'AVERAGE') return `Final rating = the average of ${andList(comps.map((c) => n(c.group))) || '…'}`;
  return `Final rating = ${comps.map((c) => `${c.weight ?? '?'}% ${n(c.group)}`).join(' + ') || '…'}`;
}
/** How a result was reached, in plain numbers: "40% × 3.50 + 40% × 3.60 + 20% × 3.40 = 3.52". */
export function howInWords(r) {
  if (r.final == null) return r.status === 'weights-missing' ? 'Percentages are not set yet.' : 'No final rating yet.';
  const parts = (r.breakdown || []).filter((b) => b.share);
  if (!parts.length) return `= ${r.final}`;
  return `${parts.map((b) => `${+(b.share * 100).toFixed(1)}% × ${b.used.toFixed(2)}`).join(' + ')} = ${r.final}`;
}

/** The formula in words and symbols, e.g. "F = 0.40·ST + 0.40·DEAN + 0.20·CHAIR". */
export function formulaText(f) {
  const comps = f.components || [];
  if (f.method === 'CUSTOM') return `F = ${f.expression || '…'}`;
  if (f.method === 'AVERAGE') return `F = (${comps.map((c) => c.group).join(' + ') || '…'}) / ${comps.length || 'n'}`;
  return `F = ${comps.map((c) => `${(Number(c.weight || 0) / 100).toFixed(2)}·${c.group}`).join(' + ') || '…'}`;
}
