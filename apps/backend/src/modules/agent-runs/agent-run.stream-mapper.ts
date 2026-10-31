/**
 * Pure helpers that turn SDK stream data into values the run engine can use.
 * They never return reasoning content or provider internals.
 */

const TEXT_DELTA_TYPES = new Set(["output_text_delta", "response.output_text.delta"]);

/** Returns the visible answer text of a streamed model event, if it is one. */
export function extractTextDelta(data: unknown): string | undefined {
  if (typeof data !== "object" || data === null) return undefined;
  const type: unknown = "type" in data ? data.type : undefined;
  const delta: unknown = "delta" in data ? data.delta : undefined;
  if (typeof type === "string" && TEXT_DELTA_TYPES.has(type) && typeof delta === "string") return delta;
  return undefined;
}

/** Returns the provider call id of a tool call item, used to match approval decisions. */
export function interruptionCallId(rawItem: unknown): string | undefined {
  if (typeof rawItem !== "object" || rawItem === null) return undefined;
  if ("callId" in rawItem && typeof rawItem.callId === "string") return rawItem.callId;
  if ("id" in rawItem && typeof rawItem.id === "string") return rawItem.id;
  return undefined;
}

/** Converts a provider-facing tool name back to the registry name (`editor__apply_proposal` → `editor.apply_proposal`). */
export function toRegistryToolName(providerName: string | undefined): string | undefined {
  if (providerName === undefined) return undefined;
  return providerName.replace("__", ".");
}
