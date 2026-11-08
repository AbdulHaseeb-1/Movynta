import { useEffect, useState } from "react";
import { z } from "zod";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { backendRequest } from "@/lib/backend";
import { effortKey, reasoningEffortSchema, resolveEffort, type ReasoningEffort } from "./reasoningEfforts";
import { selectAssistantEffort } from "./selectionSlice";
import { useAssistantSelection } from "./useAssistantSelection";

const capabilitiesSchema = z.object({
  efforts: z.array(reasoningEffortSchema),
});

/** What each model supports rarely changes, so answers are kept for the session. */
const capabilityCache = new Map<string, readonly ReasoningEffort[]>();
const NONE: readonly ReasoningEffort[] = [];

/**
 * The reasoning efforts the selected model accepts, loaded from the backend, and the user's choice
 * among them. `efforts` is empty while loading and for models that have no effort setting.
 */
export function useReasoningEffort() {
  const dispatch = useAppDispatch();
  const { provider, model, connected } = useAssistantSelection();
  const providerId = provider?.id;
  const key = providerId && model ? effortKey(providerId, model) : "";
  const [loaded, setLoaded] = useState<{
    key: string;
    efforts: readonly ReasoningEffort[];
    failed: boolean;
  }>({ key: "", efforts: NONE, failed: false });
  const saved = useAppSelector((state) => (key ? state.assistantSelection.efforts[key] : undefined));

  useEffect(() => {
    if (!key || !providerId || !connected) return undefined;
    if (capabilityCache.has(key)) return undefined;
    const abort = new AbortController();
    void backendRequest(
      `/providers/${providerId}/capabilities?model=${encodeURIComponent(model)}`,
      capabilitiesSchema,
      "GET",
      undefined,
      abort.signal,
    )
      .then((result) => {
        capabilityCache.set(key, result.efforts);
        setLoaded({ key, efforts: result.efforts, failed: false });
      })
      .catch(() => {
        if (abort.signal.aborted) return;
        // Typically an older backend that does not know the endpoint yet; the picker says so instead of hiding.
        setLoaded({ key, efforts: NONE, failed: true });
      });
    return () => abort.abort();
  }, [key, providerId, model, connected]);

  // Ignore an answer that belongs to a model that is no longer selected.
  const efforts = capabilityCache.get(key) ?? (loaded.key === key ? loaded.efforts : NONE);
  return {
    failed: loaded.key === key && loaded.failed,
    efforts,
    effort: resolveEffort(saved, efforts),
    setEffort: (effort: ReasoningEffort | null) => {
      if (key) dispatch(selectAssistantEffort({ key, effort }));
    },
  };
}
