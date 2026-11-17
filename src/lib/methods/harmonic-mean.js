// Weighted harmonic mean:  F = 1 / (0.40/ST + 0.40/DEAN + 0.20/CHAIR)
// The strictest of the averages: a low rating in one group pulls the final rating down the most.
import { shares, num, dec } from './util.js';

export default {
  id: 'HARMONIC_MEAN',
  label: 'Percentages, and a low rating counts the most',
  help: 'The strictest: if one group gives a low rating, the final rating goes down the most (harmonic mean).',
  advanced: true,
  usesWeights: true,
  // "count it as 0" would divide by zero, so it is not offered
  missingRules: ['REWEIGHT', 'INVALIDATE', 'SUBSTITUTE_MEAN'],
  compute(items) {
    if (items.some((x) => !(x.value > 0))) return { raw: null, error: 'A harmonic mean needs every rating above 0.' };
    const parts = shares(items).map((x) => ({ group: x.group, share: x.share, contribution: null }));
    return {
      raw: 1 / parts.reduce((a, p, i) => a + p.share / items[i].value, 0),
      parts,
      how: `1 ÷ (${parts.map((p, i) => `${p.share.toFixed(2)} ÷ ${num(items[i].value)}`).join(' + ')})`,
    };
  },
  words: (comps, n) => `Final rating = ${comps.map((c) => `${c.weight ?? '?'}% ${n(c.group)}`).join(' + ') || '…'}, where a low rating counts the most`,
  symbols: (comps) => `F = 1 / (${comps.map((c) => `${dec(c.weight)}/${c.group}`).join(' + ') || '…'})`,
};
