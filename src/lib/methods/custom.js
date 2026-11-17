// HR's own formula, written with group names, numbers, + - * / ( ) and avg(), min(), max().
// It is read by the safe calculator in ../expression.js (no eval, no code).
import { parseExpression, evaluate, expressionVars } from '../expression.js';
import { num } from './util.js';

export default {
  id: 'CUSTOM',
  label: 'Write my own formula',
  help: 'Only if none of the other choices fits. Example: 0.3*ST + 0.5*DEAN + 0.2*CHAIR.',
  advanced: true,
  usesWeights: false,
  usesExpression: true,
  // re-weighting needs percentages, which a written formula does not have
  missingRules: ['INVALIDATE', 'ZERO', 'SUBSTITUTE_MEAN'],
  validate(f, { groupNames = {} } = {}) {
    const comps = f.components || [];
    try {
      const used = expressionVars(parseExpression(f.expression, comps.map((c) => c.group)));
      const unused = comps.filter((c) => !used.has(c.group));
      return unused.length ? [`The expression does not use: ${unused.map((c) => groupNames[c.group] || c.group).join(', ')}. Remove them from the groups or use them.`] : [];
    } catch (e) { return [`Expression: ${e.message}`]; }
  },
  compute(items, f) {
    const env = Object.fromEntries(items.map((x) => [x.group, x.value]));
    let how = f.expression;
    for (const x of items) how = how.replace(new RegExp(`\\b${x.group}\\b`, 'gi'), num(x.value));
    return { raw: evaluate(parseExpression(f.expression, items.map((x) => x.group)), env), how, error: 'The expression could not be computed (a value is missing or a division by zero).' };
  },
  words: (comps, n, f) => `Final rating = ${comps.reduce((t, c) => t.replace(new RegExp(`\\b${c.group}\\b`, 'gi'), n(c.group)), f.expression || '…')}`,
  symbols: (comps, f) => `F = ${f.expression || '…'}`,
};
