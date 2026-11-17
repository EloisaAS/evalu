// Small helpers shared by the computation modules.

/** "A, B and C" */
export const andList = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);
/** Each group's share of the total weight (0..1). */
export const shares = (items) => {
  const total = items.reduce((a, x) => a + x.weight, 0);
  return items.map((x) => ({ ...x, share: total ? x.weight / total : 0 }));
};
/** 0.4 → "40%" */
export const pct = (share) => `${+(share * 100).toFixed(1)}%`;
/** 3.5 → "3.50" */
export const num = (v) => v.toFixed(2);
/** 40 → "0.40" (a percentage as a decimal, for the formula in symbols) */
export const dec = (weight) => (Number(weight || 0) / 100).toFixed(2);
