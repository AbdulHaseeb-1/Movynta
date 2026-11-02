/**
 * A place for results to go, so the engine cannot decide a measured call has no effect and skip it.
 * Every benchmarked function feeds its return value to `consume`; each suite reads `sinkValue()` at
 * the end and reports it.
 */
let accumulator = 0;

export function consume(value: unknown): void {
  if (typeof value === "number") accumulator = (accumulator + value) | 0;
  else if (typeof value === "string" || Array.isArray(value)) accumulator = (accumulator + value.length) | 0;
  else if (value instanceof Map || value instanceof Set) accumulator = (accumulator + value.size) | 0;
  else if (value !== undefined && value !== null) accumulator = (accumulator + 1) | 0;
}

export function sinkValue(): number {
  return accumulator;
}
