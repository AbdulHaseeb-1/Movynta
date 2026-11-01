import { useAppSelector } from "@/app/hooks";
import { useMemo } from "react";

export function useAssistantSelection() {
  const items = useAppSelector((state) => state.providers.items);
  const selection = useAppSelector((state) => state.assistantSelection);
  const connected = useAppSelector((state) => state.providers.connected);
  return useMemo(() => {
    const configured = items.filter((item) => item.configured);
    const provider =
      configured.find((item) => item.id === selection.providerId) ??
      configured.find((item) => item.active) ??
      configured[0];
    const model =
      provider?.id === selection.providerId
        ? selection.model
        : (provider?.model ?? "");
    return {
      provider,
      model,
      connected,
      providers: configured,
    };
  }, [items, selection, connected]);
}
