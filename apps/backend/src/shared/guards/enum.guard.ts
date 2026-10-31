/** True when `value` is one of the allowed literal strings. */
export function isOneOf<const T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === "string" && values.some((allowed) => allowed === value);
}

/** Returns `value` narrowed to the allowed literals, or throws naming the field. Used for stored values. */
export function requireOneOf<const T extends string>(values: readonly T[], value: string, label: string): T {
  if (isOneOf(values, value)) return value;
  throw new Error(`Unexpected ${label} "${value}"`);
}
