import { Plug } from "lucide-react";
import { siAnthropic, siGoogle, siOpenai } from "simple-icons";
import { cn } from "@/lib/utils";
import { isCompatibleProvider, type ProviderId } from "./providersSlice";

const BRAND_PATHS: Readonly<Record<ProviderId, string>> = {
  openai: siOpenai.path,
  chatgpt: siOpenai.path,
  "openai-compatible": siOpenai.path,
  anthropic: siAnthropic.path,
  "anthropic-compatible": siAnthropic.path,
  google: siGoogle.path,
};

interface ProviderIconProps {
  id: ProviderId;
  className?: string;
}

/** The provider's mark in the current text color. Compatible endpoints get a small plug badge. */
export function ProviderIcon({ id, className }: ProviderIconProps) {
  return (
    <span className={cn("relative inline-grid size-5 place-items-center", className)}>
      <svg viewBox="0 0 24 24" className="size-full fill-current" aria-hidden="true">
        <path d={BRAND_PATHS[id]} />
      </svg>
      {isCompatibleProvider(id) && (
        <Plug
          className="absolute -right-1.5 -bottom-1.5 size-3 rounded-full bg-popover p-px text-foreground"
          aria-hidden="true"
        />
      )}
    </span>
  );
}
