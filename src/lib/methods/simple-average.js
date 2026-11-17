// Simple average: every group counts the same.  F = (ST + DEAN + CHAIR) / 3
import { andList, num } from './util.js';

export default {
  id: 'AVERAGE',
  label: 'Count every group the same',
  help: 'Example: Students, Dean and Program Chair added, then divided by 3 (simple average).',
  usesWeights: false,
  equalShares: true,
  missingRules: ['REWEIGHT', 'INVALIDATE', 'ZERO', 'SUBSTITUTE_MEAN'],
  compute(items) {
    const parts = items.map((x) => ({ group: x.group, share: 1 / items.length, contribution: x.value / items.length }));
    return {
      raw: items.reduce((a, x) => a + x.value, 0) / items.length,
      parts,
      how: `(${items.map((x) => num(x.value)).join(' + ')}) ÷ ${items.length}`,
    };
  },
  words: (comps, n) => `Final rating = the average of ${andList(comps.map((c) => n(c.group))) || '…'}`,
  symbols: (comps) => `F = (${comps.map((c) => c.group).join(' + ') || '…'}) / ${comps.length || 'n'}`,
};
