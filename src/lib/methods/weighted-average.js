// Weighted average: each group counts for a percentage.  F = 0.40·ST + 0.40·DEAN + 0.20·CHAIR
import { shares, pct, num, dec } from './util.js';

export default {
  id: 'WEIGHTED_AVERAGE',
  version: 1,
  label: 'Give each group a percentage',
  help: 'Example: 40% Students + 40% Dean + 20% Program Chair (weighted average).',
  usesWeights: true,
  missingRules: ['REWEIGHT', 'INVALIDATE', 'ZERO', 'SUBSTITUTE_MEAN'],
  compute(items) {
    const parts = shares(items).map((x) => ({ group: x.group, share: x.share, contribution: x.value * x.share }));
    return {
      raw: parts.reduce((a, p) => a + p.contribution, 0),
      parts,
      how: parts.map((p, i) => `${pct(p.share)} × ${num(items[i].value)}`).join(' + '),
    };
  },
  words: (comps, n) => `Final rating = ${comps.map((c) => `${c.weight ?? '?'}% ${n(c.group)}`).join(' + ') || '…'}`,
  symbols: (comps) => `F = ${comps.map((c) => `${dec(c.weight)}·${c.group}`).join(' + ') || '…'}`,
};
