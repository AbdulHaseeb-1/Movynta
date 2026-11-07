import { selectionOperation } from "@/features/viewport3d/selectionOperation";
import { isShortcutBlocked } from "@/lib/dom";
import type { Viewport } from "@/features/viewport3d";

/** Drag to box-select, or click to select one component. Space-drag remains available for panning. */
export class ComponentBoxSelection {
  private readonly cleanup: () => void;
  constructor(
    viewport: Viewport,
    select: (start: { x: number; y: number }, end: PointerEvent) => void,
    blocked: () => boolean,
    canStart: () => boolean,
    click: (event: PointerEvent) => void,
  ) {
    const dom = viewport.renderer.domElement;
    let armed = false;
    let navigationHeld = false;
    let automatic = false;
    let start: { x: number; y: number } | undefined;
    let frame: HTMLDivElement | undefined;
    const cancel = () => {
      armed = false;
      automatic = false;
      start = undefined;
      dom.style.cursor = "";
      frame?.remove();
      frame = undefined;
    };
    const key = (event: KeyboardEvent) => {
      if (isShortcutBlocked(event.target)) return;
      if (event.code === "Space") navigationHeld = true;
      if (blocked()) return;
      if (event.key === "Escape" && armed) {
        event.preventDefault(); event.stopImmediatePropagation(); cancel();
      } else if (event.key.toLowerCase() === "b" && !event.ctrlKey && !event.altKey && !event.metaKey && !event.repeat) {
        event.preventDefault(); event.stopImmediatePropagation();
        armed = true; dom.style.cursor = "crosshair";
      }
    };
    const down = (event: PointerEvent) => {
      if (!armed) {
        if (blocked() || navigationHeld || event.button !== 0 || !canStart()) return;
        armed = true;
        automatic = true;
      }
      event.preventDefault(); event.stopImmediatePropagation();
      if (event.button !== 0) { cancel(); return; }
      start = { x: event.clientX, y: event.clientY };
      dom.setPointerCapture(event.pointerId);
    };
    const move = (event: PointerEvent) => {
      if (!start) return;
      if (!frame && Math.abs(start.x - event.clientX) < 4 && Math.abs(start.y - event.clientY) < 4) return;
      if (!frame) {
        frame = document.createElement("div");
        frame.style.cssText = "position:fixed;pointer-events:none;z-index:40;border:1px solid var(--foreground);background:color-mix(in srgb,var(--foreground) 10%,transparent)";
        document.body.appendChild(frame);
      }
      frame.textContent = ` ${selectionOperation(event)} `;
      frame.style.color = "var(--foreground)";
      frame.style.fontSize = "11px";
      frame.style.left = `${Math.min(start.x, event.clientX)}px`;
      frame.style.top = `${Math.min(start.y, event.clientY)}px`;
      frame.style.width = `${Math.abs(start.x - event.clientX)}px`;
      frame.style.height = `${Math.abs(start.y - event.clientY)}px`;
    };
    const up = (event: PointerEvent) => {
      if (!start) return;
      event.preventDefault(); event.stopImmediatePropagation();
      const origin = start;
      if (dom.hasPointerCapture(event.pointerId)) dom.releasePointerCapture(event.pointerId);
      if (Math.abs(origin.x - event.clientX) >= 4 || Math.abs(origin.y - event.clientY) >= 4) select(origin, event);
      else if (automatic) click(event);
      cancel();
    };
    const keyUp = (event: KeyboardEvent) => { if (event.code === "Space") navigationHeld = false; };
    const blur = () => { navigationHeld = false; cancel(); };
    window.addEventListener("keydown", key, true);
    window.addEventListener("keyup", keyUp);
    window.addEventListener("blur", blur);
    dom.addEventListener("pointerdown", down, true);
    dom.addEventListener("pointermove", move);
    dom.addEventListener("pointerup", up, true);
    dom.addEventListener("pointercancel", cancel);
    this.cleanup = () => {
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("keyup", keyUp);
      window.removeEventListener("blur", blur);
      dom.removeEventListener("pointerdown", down, true);
      dom.removeEventListener("pointermove", move);
      dom.removeEventListener("pointerup", up, true);
      dom.removeEventListener("pointercancel", cancel);
      cancel();
    };
  }
  dispose() { this.cleanup(); }
}
