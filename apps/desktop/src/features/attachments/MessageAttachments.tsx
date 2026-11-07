import { useState } from "react";
import { ImageIcon } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { MessageAttachment } from "./types";

/**
 * The pictures sent with a message, above its text. A picture this session still has opens large when clicked.
 * One from a reopened project has only its name, since pictures are not stored, and shows as a labelled chip.
 */
export function MessageAttachments({ attachments }: { attachments: readonly MessageAttachment[] }) {
  const [open, setOpen] = useState<MessageAttachment | null>(null);
  if (attachments.length === 0) return null;
  return (
    <>
      <ul aria-label="Attached images" className="flex max-w-[88%] flex-wrap justify-end gap-1.5">
        {attachments.map((attachment) => (
          <li key={attachment.id}>
            {attachment.src ? (
              <button
                type="button"
                onClick={() => setOpen(attachment)}
                aria-label={`Open ${attachment.name}`}
                className="block overflow-hidden rounded-xl border border-border bg-card outline-none transition-colors hover:border-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                <img src={attachment.src} alt={attachment.name} className="block size-20 object-cover" draggable={false} />
              </button>
            ) : (
              <span
                title="The picture is not stored with the project"
                className="inline-flex max-w-44 items-center gap-1.5 rounded-xl bg-foreground/[0.06] px-2.5 py-1.5 text-xs text-muted-foreground"
              >
                <ImageIcon className="size-3.5 shrink-0" />
                <span className="truncate">{attachment.name}</span>
              </span>
            )}
          </li>
        ))}
      </ul>
      <Dialog open={open !== null} onOpenChange={(next) => !next && setOpen(null)}>
        <DialogContent className="z-[100] w-[min(880px,calc(100vw-32px))] gap-3 p-4">
          <DialogTitle className="pr-6 text-sm font-semibold break-all">{open?.name}</DialogTitle>
          <DialogDescription className="sr-only">The picture you sent with this message.</DialogDescription>
          {open?.src && <img src={open.src} alt={open.name} className="max-h-[70vh] w-full rounded-md object-contain" />}
        </DialogContent>
      </Dialog>
    </>
  );
}
