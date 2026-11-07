import type { z } from "zod";

/**
 * Reads a JSON value saved in localStorage and checks it against `schema`. Storage can be unavailable, the
 * value can be missing or damaged, and it can come from an older version, so every failure reads as nothing
 * saved (`undefined`) and the caller falls back to its own defaults.
 */
export function readStored<T>(key: string, schema: z.ZodType<T>): T | undefined {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return undefined;
    const parsed = schema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/** Saves a JSON value. Storage is optional, so a failed write is skipped and the value still works for this session. */
export function writeStored(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage is optional.
  }
}

/** Forgets a saved value. Storage is optional, so a failure is skipped. */
export function removeStored(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Storage is optional.
  }
}
