import { Box, X } from "lucide-react";
import type { ObjectTransform } from "@/features/assistant";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { TransformFields } from "./TransformFields";
import type { SelectedObject } from "./useObjectEditing";

interface TransformPanelProps {
  object: SelectedObject;
  /** True while the assistant is working; the values are shown but cannot be changed. */
  disabled: boolean;
  onChange: (patch: Partial<ObjectTransform>) => void;
  onPreview: (patch: Partial<ObjectTransform>) => void;
  onPreviewEnd: (commit: boolean) => void;
  onDeselect: () => void;
  className?: string;
}

/**
 * The selected object's name and exact position, rotation and scale. Typing a value does the same as
 * dragging a handle, and is saved the same way.
 */
export function TransformPanel({
  object,
  disabled,
  onChange,
  onPreview,
  onPreviewEnd,
  onDeselect,
  className,
}: TransformPanelProps) {
  return (
    <section
      aria-label="Selected object"
      className={cn(
        "pointer-events-auto rounded-xl border border-border bg-card/95 p-2 text-xs text-foreground shadow-xl",
        className,
      )}
    >
      <header className="mb-1.5 flex items-center gap-2">
        <Box className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <h2 className="min-w-0 flex-1 truncate text-[13px] font-medium" title={object.name}>
          {object.name}
        </h2>
        {object.count > 1 && (
          <span className="shrink-0 rounded-full bg-foreground/10 px-2 py-0.5 text-[11px] text-muted-foreground">
            {object.count} selected
          </span>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onDeselect}
          aria-label="Deselect"
          title="Deselect (Esc)"
          className="size-6 rounded-full text-muted-foreground hover:text-foreground"
        >
          <X className="size-4" />
        </Button>
      </header>
      <TransformFields transform={object.transform} disabled={disabled} onChange={onChange} onPreview={onPreview} onPreviewEnd={onPreviewEnd} />
      {!disabled && <p className="mt-1.5 text-[10px] text-muted-foreground">G, R, and S transform. X, Y, or Z lock an axis.</p>}
      {(disabled || object.count > 1) && (
        <p className="mt-1.5 text-[10px] leading-4 text-muted-foreground">
          {disabled
            ? "Wait for the assistant to finish to edit this object."
            : "Values are the active object. Handles move the whole selection."}
        </p>
      )}
    </section>
  );
}
