import { useEffect, useRef, type MouseEvent, type PointerEvent } from "react";

interface ScrubOptions {
  value: number;
  step: number;
  min?: number;
  max?: number;
  disabled?: boolean;
  onPreview: (value: number) => void;
  onCommit: (value: number) => void;
  onCancel: (value: number) => void;
}
interface Gesture {
  pointerId: number;
  startX: number;
  initial: number;
  current: number;
  moved: boolean;
  /** The value and pointer position the drag is measured from; they move on when Shift is pressed or released. */
  base: number;
  baseX: number;
  fine: boolean;
}
/** Pure calculation shared by text and modifier inputs. Shift makes dragging ten times finer. */
export function scrubValue(
  initial: number,
  pixels: number,
  step: number,
  fine: boolean,
  min = -Infinity,
  max = Infinity,
): number {
  const next = initial + (pixels * step) / (fine ? 50 : 5);
  const rounded = Number(next.toFixed(6));
  const stepped = Number.isInteger(step)
    ? Math.round(rounded / step) * step
    : rounded;
  return Math.min(max, Math.max(min, stepped));
}
export function useNumberScrub(options: ScrubOptions) {
  const gesture = useRef<Gesture | null>(null);
  const suppressClick = useRef(false);
  const escapeListener = useRef<((event: KeyboardEvent) => void) | null>(null);
  const blurListener = useRef<(() => void) | null>(null);
  const frame = useRef<number | null>(null);
  const preview = useRef(options.onPreview);
  preview.current = options.onPreview;
  function clearFrame() {
    if (frame.current !== null) window.cancelAnimationFrame(frame.current);
    frame.current = null;
  }
  function flushPreview() {
    if (frame.current === null) return;
    clearFrame();
    if (gesture.current?.moved) preview.current(gesture.current.current);
  }
  function clearEscapeListener() {
    if (escapeListener.current)
      window.removeEventListener("keydown", escapeListener.current, true);
    escapeListener.current = null;
    if (blurListener.current)
      window.removeEventListener("blur", blurListener.current);
    blurListener.current = null;
  }
  useEffect(
    () => () => {
      if (escapeListener.current)
        window.removeEventListener("keydown", escapeListener.current, true);
      if (blurListener.current)
        window.removeEventListener("blur", blurListener.current);
      if (frame.current !== null) window.cancelAnimationFrame(frame.current);
    },
    [],
  );
  function onPointerDown(event: PointerEvent<HTMLElement>) {
    if (
      options.disabled ||
      event.button !== 0 ||
      !Number.isFinite(options.value)
    )
      return;
    event.preventDefault();
    suppressClick.current = false;
    clearEscapeListener();
    escapeListener.current = (key) => {
      if (key.key === "Escape") {
        key.preventDefault();
        key.stopImmediatePropagation();
        cancel();
      }
    };
    window.addEventListener("keydown", escapeListener.current, true);
    blurListener.current = cancel;
    window.addEventListener("blur", blurListener.current);
    gesture.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      initial: options.value,
      current: options.value,
      moved: false,
      base: options.value,
      baseX: event.clientX,
      fine: event.shiftKey,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function onPointerMove(event: PointerEvent<HTMLElement>) {
    const drag = gesture.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!drag.moved && Math.abs(event.clientX - drag.startX) < 4) return;
    drag.moved = true;
    event.preventDefault();
    // Pressing or releasing Shift mid-drag carries on from the value reached, instead of rescaling the whole drag.
    if (event.shiftKey !== drag.fine) {
      drag.base = drag.current;
      drag.baseX = event.clientX;
      drag.fine = event.shiftKey;
    }
    drag.current = scrubValue(
      drag.base,
      event.clientX - drag.baseX,
      options.step,
      event.shiftKey,
      options.min,
      options.max,
    );
    if (frame.current === null)
      frame.current = window.requestAnimationFrame(() => {
        frame.current = null;
        if (gesture.current?.moved) preview.current(gesture.current.current);
      });
  }
  function onPointerUp(event: PointerEvent<HTMLElement>) {
    const drag = gesture.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    flushPreview();
    gesture.current = null;
    clearEscapeListener();
    if (drag.moved) {
      suppressClick.current = true;
      event.preventDefault();
      options.onCommit(drag.current);
    }
  }
  function cancel() {
    const drag = gesture.current;
    clearFrame();
    gesture.current = null;
    clearEscapeListener();
    if (drag?.moved) options.onCancel(drag.initial);
  }
  function onPointerCancel() {
    cancel();
  }
  function onLostPointerCapture() {
    cancel();
  }
  function onClick(event: MouseEvent<HTMLElement>) {
    if (suppressClick.current) {
      suppressClick.current = false;
      event.preventDefault();
      event.stopPropagation();
    }
  }
  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onLostPointerCapture,
    onClick,
    cancel,
  };
}
