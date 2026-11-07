import { useRef, type ClipboardEvent, type FormEvent } from "react";
import { ArrowUp, ImagePlus, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  AttachButton,
  AttachmentTray,
  picturesFromClipboard,
  useFileDrop,
  type ImageAttachments,
} from "../attachments";
import { ASSISTANT_NAME } from "./branding";
import { composerKeyAction } from "./composerKeys";
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
  /** The pictures chosen for this message. */
  attachments: ImageAttachments;
  /** False when the selected model connection is set not to receive pictures. */
  picturesAllowed: boolean;
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
 * The message on top, then the pictures chosen for it, then the attach button, the model, its reasoning effort,
 * and Send. Enter sends, Shift+Enter adds a line, Esc stops a running reply. Pictures can be attached with the
 * button, pasted into the field, or dropped anywhere on the composer.
 */
export function Composer({
  variant,
  value,
  onChange,
  onSubmit,
  onStop,
  busy,
  ready,
  attachments,
  picturesAllowed,
}: ComposerProps) {
  const hasContent = Boolean(value.trim()) || attachments.images.length > 0;
  const canSend = hasContent && ready && !busy && !attachments.preparing;
  const hero = variant === "hero";
  const attachable = picturesAllowed && !busy && !attachments.full;
  const form = useRef<HTMLFormElement>(null);

  function addFiles(files: File[]) {
    if (picturesAllowed && !busy) void attachments.add(files);
  }

  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const files = picturesFromClipboard(event.clipboardData);
    if (files.length === 0) return;
    // Copying from a page puts text and a picture on the clipboard together; the text still goes into the field.
    if (!event.clipboardData.getData("text/plain")) event.preventDefault();
    addFiles(files);
  }

  const dragging = useFileDrop(form, attachable, addFiles);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (canSend) onSubmit();
  }

  return (
    <form
      className={cn(
        "relative pointer-events-auto flex flex-col gap-1 bg-foreground/[0.07] bg-[radial-gradient(ellipse_at_28%_0%,rgb(255_255_255_/_0.10),transparent_72%)] transition-colors duration-200 focus-within:bg-foreground/[0.1]",
        hero
          ? "rounded-3xl bg-black/60 px-4 pt-3.5 pb-2.5 text-left backdrop-blur-xl focus-within:bg-black/70"
          : "rounded-2xl p-3",
      )}
      onSubmit={handleSubmit}
      ref={form}
    >
      {dragging && (
        <div
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-0 z-10 grid place-items-center border-2 border-dashed backdrop-blur-sm",
            hero ? "rounded-3xl" : "rounded-2xl",
            attachable ? "border-brand/60 bg-background/70 text-foreground" : "border-border bg-background/70 text-muted-foreground",
          )}
        >
          <span className="flex items-center gap-2 text-sm">
            <ImagePlus className="size-4" />
            {!picturesAllowed ? "This model connection does not take pictures" : attachments.full ? "No room for more images" : "Drop images to attach"}
          </span>
        </div>
      )}
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
        onPaste={handlePaste}
        onKeyDown={(event) => {
          const action = composerKeyAction(
            { key: event.key, shiftKey: event.shiftKey, isComposing: event.nativeEvent.isComposing },
            busy,
          );
          if (action === "stop") onStop();
          if (action === "send") {
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
      <AttachmentTray
        images={attachments.images}
        preparing={attachments.pending}
        disabled={busy}
        onRemove={attachments.remove}
      />
      {attachments.error && (
        <p role="alert" className="mx-1 flex items-start gap-1.5 text-xs text-muted-foreground">
          <span className="min-w-0 flex-1 break-words">{attachments.error}</span>
          <button
            type="button"
            onClick={attachments.dismissError}
            aria-label="Dismiss"
            className="shrink-0 rounded-sm outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="size-3.5" />
          </button>
        </p>
      )}
      <div className="flex items-center justify-between gap-2">
        <div className="-ml-1 flex min-w-0 items-center gap-0.5">
          <AttachButton
            disabled={!attachable}
            disabledReason={
              !picturesAllowed
                ? "This model connection is set not to receive pictures. Turn on Send pictures in Settings > Providers."
                : attachments.full
                  ? "You have attached the most images a message can carry"
                  : undefined
            }
            onFiles={addFiles}
          />
          <ModelProviderSelector disabled={busy} />
          <EffortSelector disabled={busy} />
        </div>
        <SendButton busy={busy} canSend={canSend} onStop={onStop} />
      </div>
    </form>
  );
}
