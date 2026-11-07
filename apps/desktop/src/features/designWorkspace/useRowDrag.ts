import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

/** Marks a line that something can be dropped on. Its value is the object's id. */
export const ROW_ATTRIBUTE = "data-outliner-row";
/** Marks the list itself: dropping in it, away from any line, means the top level. */
export const LIST_ATTRIBUTE = "data-outliner-list";

/** How far the pointer must travel before a press becomes a drag, so a plain click is never one. */
const DRAG_THRESHOLD = 4;

/** A drag of an outliner row, and where it would drop. */
export interface RowDrag {
  /** The object being dragged. */
  readonly id: string;
  /** Where it would land: an object's id, null for the top level, undefined when the pointer is over nothing it can go to. */
  readonly target: string | null | undefined;
}

interface Options {
  readonly disabled: boolean;
  readonly canDrop: (id: string, target: string | null) => boolean;
  readonly onDrop: (id: string, target: string | null) => void;
}

function targetAt(x: number, y: number): string | null | undefined {
  const hit = document.elementFromPoint(x, y);
  const row = hit?.closest(`[${ROW_ATTRIBUTE}]`);
  if (row) return row.getAttribute(ROW_ATTRIBUTE) ?? undefined;
  return hit?.closest(`[${LIST_ATTRIBUTE}]`) ? null : undefined;
}

/**
 * Drag and drop with pointer events. The browser's own drag and drop is not used because a desktop webview can
 * take it over for files dropped on the window. Returns the drag in progress, a handler for a line's
 * `onPointerDown`, and `wasDrag`, which is true once right after a drag so the click that ends it can be ignored.
 */
export function useRowDrag({ disabled, canDrop, onDrop }: Options) {
  const [drag, setDrag] = useState<RowDrag | null>(null);
  const finished = useRef(false);
  const stop = useRef<(() => void) | null>(null);
  const latest = useRef({ canDrop, onDrop });
  useEffect(() => {
    latest.current = { canDrop, onDrop };
  });
  useEffect(() => () => stop.current?.(), []);

  const start = useCallback(
    (id: string) => (event: ReactPointerEvent) => {
      if (disabled || event.button !== 0) return;
      if (event.target instanceof Element && event.target.closest("button, input")) return;
      stop.current?.();
      const origin = { x: event.clientX, y: event.clientY };
      let dragging = false;
      let target: string | null | undefined;
      const move = (next: PointerEvent) => {
        if (!dragging) {
          if (Math.hypot(next.clientX - origin.x, next.clientY - origin.y) < DRAG_THRESHOLD) return;
          dragging = true;
        }
        const over = targetAt(next.clientX, next.clientY);
        target = over !== undefined && latest.current.canDrop(id, over) ? over : undefined;
        setDrag((current) => (current?.id === id && current.target === target ? current : { id, target }));
      };
      const end = (commit: boolean) => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", cancel);
        window.removeEventListener("keydown", key);
        stop.current = null;
        if (dragging) {
          finished.current = true;
          // The click that follows a drag is swallowed; if none comes, forget it on the next turn.
          setTimeout(() => (finished.current = false), 0);
          if (commit && target !== undefined) latest.current.onDrop(id, target);
        }
        setDrag(null);
      };
      const up = () => end(true);
      const cancel = () => end(false);
      const key = (next: KeyboardEvent) => {
        if (next.key === "Escape") end(false);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", cancel);
      window.addEventListener("keydown", key);
      stop.current = () => end(false);
    },
    [disabled],
  );

  const wasDrag = useCallback(() => {
    const was = finished.current;
    finished.current = false;
    return was;
  }, []);

  return { drag, start, wasDrag };
}
