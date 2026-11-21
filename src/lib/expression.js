// Safe calculator for HR's own formulas (no eval): numbers, group names, arithmetic,
// comparisons and avg(), min(), max(), if().
// It never runs code typed by a user; any other word or symbol is rejected.

// Only the exact names in these lists are accepted (never built-in object names like 'constructor').
export const has = (o, k) => typeof k === 'string' && Object.hasOwn(o, k);

const FUNCS = {
  avg: (xs) => xs.reduce((a, b) => a + b, 0) / xs.length,
  min: (xs) => Math.min(...xs),
  max: (xs) => Math.max(...xs),
  if: null,
};
function tokenize(src) {
  const out = [];
  const re = /\s*(?:(\d+(?:\.\d+)?|\.\d+)|([A-Za-z_][A-Za-z_]*)|((?:<=|>=|==|!=|[<>])|[-+*/(),]))/y;
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
        const args = [compare()];
        while (peek()?.t === ',') { p++; args.push(compare()); }
        take(')');
        if (fn === 'if' && args.length !== 3) throw new Error('if() needs three values: if(condition, whenTrue, whenFalse).');
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
  function compare() {
    const a = expr();
    if (['<', '<=', '>', '>=', '==', '!='].includes(peek()?.t)) {
      const op = toks[p++].t;
      return { op: 'cmp', cmp: op, a, b: expr() };
    }
    return a;
  }
  const tree = compare();
  if (p < toks.length) throw new Error(`Unexpected "${toks[p].v ?? toks[p].t}" after the end of the expression.`);
  return tree;
}
/** Evaluate a parsed expression with group scores; null if a value is missing or a division by zero happens. */
export function evaluate(node, env) {
  switch (node.op) {
    case 'num': return node.v;
    case 'var': return has(env, node.v) ? env[node.v] ?? null : null;
    case 'neg': { const a = evaluate(node.a, env); return a == null ? null : -a; }
    case 'fn': {
      if (!has(FUNCS, node.fn)) return null;
      if (node.fn === 'if') {
        const condition = evaluate(node.args[0], env);
        return condition == null ? null : evaluate(node.args[condition ? 1 : 2], env);
      }
      const xs = node.args.map((x) => evaluate(x, env));
      return xs.some((x) => x == null) ? null : FUNCS[node.fn](xs);
    }
    default: {
      const a = evaluate(node.a, env), b = evaluate(node.b, env);
      if (a == null || b == null) return null;
      if (node.op === 'cmp') {
        if (node.cmp === '<') return a < b ? 1 : 0;
        if (node.cmp === '<=') return a <= b ? 1 : 0;
        if (node.cmp === '>') return a > b ? 1 : 0;
        if (node.cmp === '>=') return a >= b ? 1 : 0;
        if (node.cmp === '==') return a === b ? 1 : 0;
        if (node.cmp === '!=') return a !== b ? 1 : 0;
        return null;
      }
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
