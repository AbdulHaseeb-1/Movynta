import type { SqlRow } from "./persistence.types.js";

/** Reads a required text column, failing loudly if the schema and code disagree. */
export function textColumn(row: SqlRow, column: string): string {
  const value = row[column];
  if (typeof value !== "string") throw new Error(`Expected text column "${column}"`);
  return value;
}

/** Reads an optional text column. */
export function optionalTextColumn(row: SqlRow, column: string): string | undefined {
  const value = row[column];
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`Expected text column "${column}"`);
  return value;
}

/** Reads a required integer column. */
export function integerColumn(row: SqlRow, column: string): number {
  const value = row[column];
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  throw new Error(`Expected integer column "${column}"`);
}

/** Reads a required binary column. */
export function blobColumn(row: SqlRow, column: string): Uint8Array {
  const value = row[column];
  if (value instanceof Uint8Array) return value;
  throw new Error(`Expected blob column "${column}"`);
}
