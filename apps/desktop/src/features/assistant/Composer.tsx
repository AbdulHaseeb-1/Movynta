import type { FormEvent } from "react";
import { ArrowUp, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { ASSISTANT_NAME } from "./branding";
import { EffortSelector } from "./EffortSelector";
import { ModelProviderSelector } from "./ModelProviderSelector";

interface ComposerProps {
  /** "hero" is the large field on the empty studio; "panel" is the one pinned in the pane. */
  variant: "hero" | "panel";
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  busy: boolean;
  ready: boolean;
}

/** Send turns into Stop while the agent works; the two icons cross-fade in place. */
function SendButton({
  busy,
  canSend,
  onStop,
}: {
  busy: boolean;
  canSend: boolean;
  onStop: () => void;
}) {
  return (
    <Button
      type={busy ? "button" : "submit"}
      size="icon"
      className="relative size-8 shrink-0 rounded-full"
      onClick={busy ? onStop : undefined}
      aria-label={busy ? "Stop" : "Send"}
      disabled={!busy && !canSend}
    >
      <ArrowUp
        className={cn(
          "absolute size-[18px] transition-[opacity,transform] duration-200 motion-reduce:transition-none",
          busy ? "scale-50 -rotate-90 opacity-0" : "scale-100 opacity-100",
        )}
        strokeWidth={2}
      />
      <Square
        className={cn(
          "absolute size-3 fill-current transition-[opacity,transform] duration-200 motion-reduce:transition-none",
          busy ? "scale-100 opacity-100" : "scale-50 opacity-0",
        )}
      />
    </Button>
  );
}

/**
 * Two rows: the message on top, and below it the model, its reasoning effort, and Send.
 * Enter sends, Shift+Enter adds a line, Esc stops a running reply.
 */
export function Composer({
  variant,
  value,
  onChange,
  onSubmit,
  onStop,
  busy,
  ready,
}: ComposerProps) {
  const canSend = Boolean(value.trim()) && ready && !busy;
  const hero = variant === "hero";

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (canSend) onSubmit();
  }

  return (
    <form
      className={cn(
        "pointer-events-auto flex flex-col gap-1 bg-foreground/[0.07] bg-[radial-gradient(ellipse_at_28%_0%,rgb(255_255_255_/_0.10),transparent_72%)] transition-colors duration-200 focus-within:bg-foreground/[0.1]",
        hero
          ? "rounded-3xl bg-black/60 px-4 pt-3.5 pb-2.5 text-left backdrop-blur-xl focus-within:bg-black/70"
          : "rounded-2xl p-3",
      )}
      onSubmit={handleSubmit}
    >
      <label className="sr-only" htmlFor="design-prompt">
        {hero ? "Describe your design" : `Message ${ASSISTANT_NAME}`}
      </label>
      <Textarea
        id="design-prompt"
        rows={1}
        maxLength={4000}
        className={cn(
          "max-h-40 px-1 py-1 leading-relaxed",
          hero ? "min-h-11 text-[15px]" : "text-[13.5px]",
        )}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && busy) onStop();
          if (
            event.key === "Enter" &&
            !event.shiftKey &&
            !event.nativeEvent.isComposing
          ) {
            event.preventDefault();
            if (canSend) onSubmit();
          }
        }}
        placeholder={
          hero
            ? `Ask ${ASSISTANT_NAME} to design a friendly robot…`
            : `Message ${ASSISTANT_NAME}…`
        }
      />
      <div className="flex items-center justify-between gap-2">
        <div className="-ml-1 flex min-w-0 items-center gap-0.5">
          <ModelProviderSelector disabled={busy} />
          <EffortSelector disabled={busy} />
        </div>
        <SendButton busy={busy} canSend={canSend} onStop={onStop} />
      </div>
    </form>
  );
}
