import { randomUUID } from "node:crypto";

/**
 * A new unique identifier with a short prefix that says what kind of record it names, such as `run_<uuid>`.
 * Use it for record ids; ids that are not prefixed, such as a request id, call `randomUUID` directly.
 */
export function newId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}
