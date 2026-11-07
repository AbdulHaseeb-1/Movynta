export type Weights = ReadonlyMap<number, number>;
/** Weights that give all their influence to one index. */
export function basis(index: number): Weights {
  return new Map([[index, 1]]);
}
/** A weighted sum of several weight sets, with entries that are effectively zero dropped. */
export function blend(terms: readonly (readonly [Weights, number])[]): Weights {
  const result = new Map<number, number>();
  for (const [weights, coefficient] of terms)
    for (const [index, weight] of weights) {
      result.set(index, (result.get(index) ?? 0) + weight * coefficient);
    }
  for (const [index, weight] of result) if (Math.abs(weight) < 1e-12) result.delete(index);
  return result;
}
/** One component of a weighted attribute, so two corners can be compared by value. */
export function evaluate(
  source: { getComponent(index: number, component: number): number },
  weights: Weights,
  component: number,
): number {
  let total = 0;
  for (const [index, weight] of weights) total += source.getComponent(index, component) * weight;
  return total;
}
/** The average of several weight sets. */
export function mean(weights: readonly Weights[]): Weights {
  if (weights.length === 0) return new Map();
  return blend(weights.map((value) => [value, 1 / weights.length]));
}
