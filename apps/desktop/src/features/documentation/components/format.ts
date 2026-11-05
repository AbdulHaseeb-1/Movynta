/** Rounds for display without changing stored values. */
export function formatNumber(value: number): string {
  return String(Number(value.toFixed(3)));
}

export function formatVector(values: readonly number[]): string {
  return `[${values.map(formatNumber).join(", ")}]`;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
