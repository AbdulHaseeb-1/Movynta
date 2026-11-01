import { z } from "zod";
import { providerIdSchema } from "@/features/providers";
import { reasoningEffortSchema } from "./reasoningEfforts";

const STORAGE_KEY = "movynta.assistantSelection";

const storedSelectionSchema = z.object({
  providerId: providerIdSchema.nullable(),
  model: z.string().max(160),
  /** Chosen reasoning effort per "provider:model"; a missing entry means the model default. */
  efforts: z.record(z.string(), reasoningEffortSchema).default({}),
});

export type AssistantSelection = z.infer<typeof storedSelectionSchema>;

export const emptySelection: AssistantSelection = {
  providerId: null,
  model: "",
  efforts: {},
};

/** Reads the last provider and model the user picked. Anything missing or malformed counts as no choice. */
export function loadSelection(): AssistantSelection {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptySelection;
    const parsed = storedSelectionSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : emptySelection;
  } catch {
    return emptySelection;
  }
}

/** Remembers the selection across restarts. Storage can be unavailable, in which case it is skipped. */
export function saveSelection(selection: AssistantSelection) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(selection));
  } catch {
    // The selection still works for this session.
  }
}
