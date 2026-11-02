import { useEffect } from "react";
import { z } from "zod";
import { useAppDispatch } from "@/app/hooks";
import type { ProviderId } from "@/features/providers";
import { backendRequest } from "@/lib/backend";
import { reconcileAssistantModel } from "./selectionSlice";

const modelsSchema = z.object({ models: z.array(z.string()) });

/**
 * ChatGPT accounts only offer certain models, and the list changes with the plan. When ChatGPT becomes
 * the selected provider, a remembered model the account no longer offers is replaced by its first one.
 */
export function useChatgptModelSync(
  providerId: ProviderId | undefined,
  connected: boolean,
) {
  const dispatch = useAppDispatch();
  useEffect(() => {
    if (!connected || providerId !== "chatgpt") return undefined;
    let stopped = false;
    backendRequest("/providers/chatgpt/models", modelsSchema, "POST")
      .then(({ models }) => {
        if (!stopped) dispatch(reconcileAssistantModel({ id: "chatgpt", models }));
      })
      .catch(() => undefined);
    return () => {
      stopped = true;
    };
  }, [connected, providerId, dispatch]);
}
