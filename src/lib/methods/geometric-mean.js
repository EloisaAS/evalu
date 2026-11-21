// Weighted geometric mean: the ratings are multiplied, each raised to its group's share.
//   F = ST^0.40 × DEAN^0.40 × CHAIR^0.20
// A low rating in one group pulls the final rating down more than in an average.
import { shares, num, dec } from './util.js';

export default {
  id: 'GEOMETRIC_MEAN',
  version: 1,
  label: 'Percentages, but a low rating counts more',
  help: 'If one group gives a low rating, the final rating goes down more (geometric mean).',
  advanced: true,
  usesWeights: true,
  // "count it as 0" would make every final rating 0, so it is not offered
  missingRules: ['REWEIGHT', 'INVALIDATE', 'SUBSTITUTE_MEAN'],
  compute(items) {
    if (items.some((x) => !(x.value > 0))) return { raw: null, error: 'A geometric mean needs every rating above 0.' };
    const parts = shares(items).map((x) => ({ group: x.group, share: x.share, contribution: null }));
    return {
      raw: Math.exp(parts.reduce((a, p, i) => a + p.share * Math.log(items[i].value), 0)),
      parts,
      how: parts.map((p, i) => `${num(items[i].value)}^${p.share.toFixed(2)}`).join(' × '),
    };
  },
  words: (comps, n) => `Final rating = ${comps.map((c) => `${c.weight ?? '?'}% ${n(c.group)}`).join(' + ') || '…'}, where a low rating counts more`,
  symbols: (comps) => `F = ${comps.map((c) => `${c.group}^${dec(c.weight)}`).join(' × ') || '…'}`,
};
