import { X } from "lucide-react";
import { useAppSelector } from "@/app/hooks";
import type { ViewportTool } from "@/features/viewport3d";
import { cn } from "@/lib/utils";
import { TransformPanel } from "./TransformPanel";
import type { ObjectEditing } from "./useObjectEditing";

const HINTS: Partial<Readonly<Record<ViewportTool, string>>> = {
  move: "Click an object to move it",
  rotate: "Click an object to rotate it",
  scale: "Click an object to scale it",
};

interface ObjectEditingOverlayProps {
  editing: ObjectEditing;
  disabled: boolean;
  className?: string;
}

/**
 * The selection's values, with any problem saving a change above them. It is a column that sits where
 * its parent puts it, so it never needs to know where the other controls are.
 */
export function ObjectEditingOverlay({ editing, disabled, className }: ObjectEditingOverlayProps) {
  return (
    <div className={cn("pointer-events-none flex min-h-0 flex-col items-end gap-2", className)}>
      {editing.error && (
        <div
          role="alert"
          className="pointer-events-auto flex w-full shrink-0 items-start gap-2.5 rounded-xl bg-popover p-3 text-xs leading-5 text-popover-foreground shadow-xl ring-1 ring-border"
        >
          <p className="min-w-0 flex-1">{editing.error}</p>
          <button
            type="button"
            onClick={editing.dismissError}
            aria-label="Dismiss"
            className="grid size-5 shrink-0 place-items-center rounded-full text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}
      {editing.selected && (
        <TransformPanel
          object={editing.selected}
          disabled={disabled}
          onChange={editing.updateTransform}
          onPreview={editing.previewTransform}
          onPreviewEnd={editing.finishTransformPreview}
          onDeselect={editing.deselect}
          className="min-h-0 w-full overflow-y-auto"
        />
      )}
    </div>
  );
}

/** A line above the tools that says what to do next while a transform tool has nothing to act on. */
export function ToolHint({ hasSelection }: { hasSelection: boolean }) {
  const tool = useAppSelector((state) => state.viewport.tool);
  const hint = hasSelection ? undefined : HINTS[tool];
  if (!hint) return null;
  return (
    <output className="rounded-full bg-black/60 px-3.5 py-2 text-xs text-muted-foreground shadow-2xl backdrop-blur-2xl backdrop-saturate-150">
      {hint}
    </output>
  );
}
