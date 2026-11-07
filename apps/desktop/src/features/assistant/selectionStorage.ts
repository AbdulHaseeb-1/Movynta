import { z } from "zod";
import { readStored, writeStored } from "@/lib/storage";
import { providerIdSchema } from "@/features/providers";
import { reasoningEffortSchema } from "./reasoningEfforts";

const STORAGE_KEY = "movynta.assistantSelection";

const storedSelectionSchema = z.object({
  providerId: providerIdSchema.nullable(),
  model: z.string().max(160),
  /** Chosen reasoning effort per "provider:model"; a missing entry means the model default. */
  efforts: z.record(z.string(), reasoningEffortSchema).default({}),
});

/** The provider and model chosen for the assistant. */
export type AssistantSelection = z.infer<typeof storedSelectionSchema>;

/** The choice used before the user has chosen anything. */
export const emptySelection: AssistantSelection = {
  providerId: null,
  model: "",
  efforts: {},
};

/** Reads the last provider and model the user picked. Anything missing or malformed counts as no choice. */
export function loadSelection(): AssistantSelection {
  return readStored(STORAGE_KEY, storedSelectionSchema) ?? emptySelection;
}

/** Remembers the selection across restarts. Storage can be unavailable, in which case it is skipped. */
export function saveSelection(selection: AssistantSelection) {
  writeStored(STORAGE_KEY, selection);
}
