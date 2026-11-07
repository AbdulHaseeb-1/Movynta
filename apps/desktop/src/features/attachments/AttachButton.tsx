import { ImagePlus } from "lucide-react";
import { useRef, type ChangeEvent } from "react";
import { ATTACHMENT_MEDIA_TYPES, MAX_ATTACHMENTS } from "@movynta/contracts";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface AttachButtonProps {
  disabled?: boolean;
  /** Why attaching is unavailable, shown on hover instead of the usual hint. */
  disabledReason?: string | undefined;
  onFiles: (files: File[]) => void;
}

const ACCEPT = ATTACHMENT_MEDIA_TYPES.join(",");

/** Opens the system file picker for pictures. */
export function AttachButton({ disabled = false, disabledReason, onFiles }: AttachButtonProps) {
  const input = useRef<HTMLInputElement>(null);

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    onFiles(Array.from(event.target.files ?? []));
    // The same file can be chosen again after it was taken off.
    event.target.value = "";
  }

  return (
    <>
      <input ref={input} type="file" accept={ACCEPT} multiple hidden tabIndex={-1} aria-hidden onChange={handleChange} />
      <Tooltip>
        <TooltipTrigger asChild>
          {/* A disabled button swallows hover, so the span carries the tooltip. */}
          <span className="inline-flex">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="rounded-full text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
              disabled={disabled}
              onClick={() => input.current?.click()}
              aria-label="Attach images"
            >
              <ImagePlus className="size-4" />
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>{disabledReason ?? `Attach images (up to ${MAX_ATTACHMENTS}) · or paste or drop them`}</TooltipContent>
      </Tooltip>
    </>
  );
}
