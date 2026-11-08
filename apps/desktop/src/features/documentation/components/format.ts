/** Rounds for display without changing stored values. */
export function formatNumber(value: number): string {
  return String(Number(value.toFixed(3)));
}

/** A vector as short text with rounded numbers, for display in the documentation. */
export function formatVector(values: readonly number[]): string {
  return `[${values.map(formatNumber).join(", ")}]`;
}

/** Whether a value is a plain object: not null, and not an array. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
