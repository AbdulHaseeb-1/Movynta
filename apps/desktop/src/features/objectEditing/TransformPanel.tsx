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
  onDeselect,
  className,
}: TransformPanelProps) {
  return (
    <section
      aria-label="Selected object"
      className={cn(
        "pointer-events-auto rounded-xl bg-black/60 p-3 text-xs text-foreground shadow-2xl backdrop-blur-2xl backdrop-saturate-150",
        className,
      )}
    >
      <header className="mb-2.5 flex items-center gap-2">
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
      <TransformFields transform={object.transform} disabled={disabled} onChange={onChange} />
      <p className="mt-2.5 text-[11px] leading-4 text-muted-foreground">
        {disabled
          ? "Wait for the assistant to finish to edit this object."
          : object.count > 1
            ? "The handles move all selected objects together. These values are the active object's."
            : "G, R, and S select a transform tool. Hold Shift while dragging to snap."}
      </p>
    </section>
  );
}
