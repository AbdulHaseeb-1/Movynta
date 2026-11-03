import { useState, type KeyboardEvent } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { recallCapture } from "./capturedPictures";

/**
 * The pictures the assistant looked at, as small thumbnails under the step that took them. Clicking one
 * opens it large, with the others a key press away. Shows nothing if the pictures are no longer kept.
 */
export function CaptureGallery({ captureId }: { captureId: string }) {
  const images = recallCapture(captureId);
  const [selected, setSelected] = useState<number | null>(null);
  if (!images || images.length === 0) return null;

  const shown = selected === null ? undefined : images[selected];
  const step = (by: number) => setSelected((current) => (current === null ? current : (current + by + images.length) % images.length));
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "ArrowLeft") step(-1);
    else if (event.key === "ArrowRight") step(1);
  };

  return (
    <>
      <ul aria-label="What the assistant saw" className="flex flex-wrap gap-1.5 pb-1.5 pl-6">
        {images.map((image, index) => (
          <li key={image.id}>
            <button
              type="button"
              onClick={() => setSelected(index)}
              aria-label={`Open the ${image.label} view`}
              className="relative block overflow-hidden rounded-md border border-border bg-card outline-none transition-colors hover:border-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <img src={image.src} alt={`${image.label} view of the scene`} className="block h-[72px] w-auto" />
              <span className="absolute inset-x-0 bottom-0 truncate bg-background/75 px-1 py-px text-[10px] text-muted-foreground">
                {image.label}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <Dialog open={shown !== undefined} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent onKeyDown={onKeyDown} className="z-[100] w-[min(880px,calc(100vw-32px))] gap-3 p-4">
          <DialogTitle className="pr-6 text-sm font-semibold">{shown?.label}</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">{shown?.camera}</DialogDescription>
          {shown && <img src={shown.src} alt={`${shown.label} view of the scene`} className="max-h-[70vh] w-full rounded-md object-contain" />}
          {images.length > 1 && (
            <div className="flex items-center justify-between">
              <Button variant="ghost" size="icon-sm" onClick={() => step(-1)} aria-label="Previous view">
                <ChevronLeft className="size-4" />
              </Button>
              <span className="text-xs text-muted-foreground tabular-nums">
                {(selected ?? 0) + 1} of {images.length}
              </span>
              <Button variant="ghost" size="icon-sm" onClick={() => step(1)} aria-label="Next view">
                <ChevronRight className="size-4" />
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
