import { Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBytes } from "./format";
import type { ComposerImage } from "./types";

interface AttachmentTrayProps {
  images: readonly ComposerImage[];
  /** How many more pictures are being read, shown as placeholders so the tray does not jump. */
  preparing: number;
  disabled?: boolean;
  onRemove: (id: string) => void;
}

/** The pictures chosen for the next message, as thumbnails that can each be taken off again. */
export function AttachmentTray({ images, preparing, disabled = false, onRemove }: AttachmentTrayProps) {
  if (images.length === 0 && preparing === 0) return null;
  return (
    <ul aria-label="Attached images" className="flex flex-wrap gap-2 px-1 pt-0.5 pb-1">
      {images.map((image) => (
        <li key={image.id} className="group relative">
          <img
            src={image.src}
            alt={image.name}
            title={`${image.name} · ${image.width}×${image.height} · ${formatBytes(image.bytes)}`}
            className="block size-14 rounded-lg border border-border bg-card object-cover"
            draggable={false}
          />
          <button
            type="button"
            onClick={() => onRemove(image.id)}
            disabled={disabled}
            aria-label={`Remove ${image.name}`}
            className={cn(
              "absolute -top-1.5 -right-1.5 grid size-5 place-items-center rounded-full border border-border bg-popover text-muted-foreground shadow-sm outline-none transition-opacity hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none",
              "opacity-0 group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100",
            )}
          >
            <X className="size-3" />
          </button>
        </li>
      ))}
      {Array.from({ length: preparing }, (_, index) => (
        <li key={`preparing-${index}`}>
          <output
            aria-label="Preparing an image"
            className="grid size-14 place-items-center rounded-lg border border-dashed border-border bg-card/50 text-muted-foreground"
          >
            <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
          </output>
        </li>
      ))}
    </ul>
  );
}
