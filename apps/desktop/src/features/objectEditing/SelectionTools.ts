import type { EditorScene } from "@/features/assistant";
import type { Viewport } from "@/features/viewport3d";
import { idsInRect, rectBetween } from "./boxSelect";
import type { GizmoView } from "./ObjectGizmo";
import { toNdc } from "./picking";

/** A drag shorter than this, in pixels, is a click that missed, not a rectangle. */
const MIN_BOX_PX = 4;

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  );
}

/**
 * Selecting many objects at once, with the keys Blender uses: A selects everything, Alt+A selects
 * nothing, and B lets you drag a rectangle round the objects to select (Shift keeps the selection
 * and adds to it). Shift-click, which adds one object at a time, is in the {@link ObjectGizmo}, next to
 * the click it extends. Everything here ends in a call on the {@link EditorScene}, which owns the selection.
 */
export class SelectionTools {
  private readonly viewport: Viewport;
  private readonly editor: EditorScene;
  private readonly view: GizmoView;
  private readonly cleanups: (() => void)[] = [];
  /** The rectangle's drawing, made when the first drag starts. */
  private frame: HTMLDivElement | undefined;
  private armed = false;
  private start: { x: number; y: number } | undefined;

  constructor(viewport: Viewport, editor: EditorScene, view: GizmoView) {
    this.viewport = viewport;
    this.editor = editor;
    this.view = view;
    const dom = viewport.renderer.domElement;

    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target) || event.ctrlKey || event.metaKey || event.repeat) return;
      if (event.key === "Escape" && this.armed) {
        // The first Escape puts the rectangle away; it must not also clear the selection.
        event.stopImmediatePropagation();
        this.cancel();
        return;
      }
      if (!this.view.enabled() || !this.view.editsObjects()) return;
      const key = event.key.toLowerCase();
      if (key === "a") {
        event.preventDefault();
        if (event.altKey) this.editor.select(null);
        else this.editor.selectAll();
      } else if (key === "b" && !event.altKey) {
        event.preventDefault();
        this.arm();
      }
    };
    // In the capture phase, so the Escape that ends the rectangle is seen before anything else's.
    window.addEventListener("keydown", onKeyDown, true);

    // Also in the capture phase, so the press that starts a rectangle never reaches the camera or the handles.
    const onPointerDown = (event: PointerEvent) => {
      if (!this.armed) return;
      event.stopImmediatePropagation();
      event.preventDefault();
      if (event.button !== 0) {
        this.cancel();
        return;
      }
      this.start = { x: event.clientX, y: event.clientY };
      dom.setPointerCapture(event.pointerId);
      this.draw(event.clientX, event.clientY);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (this.start) this.draw(event.clientX, event.clientY);
    };
    const onPointerUp = (event: PointerEvent) => {
      const start = this.start;
      if (!start) return;
      event.stopImmediatePropagation();
      if (dom.hasPointerCapture(event.pointerId)) dom.releasePointerCapture(event.pointerId);
      const wide = Math.abs(event.clientX - start.x) >= MIN_BOX_PX || Math.abs(event.clientY - start.y) >= MIN_BOX_PX;
      if (wide) this.select(start, event);
      this.cancel();
    };
    dom.addEventListener("pointerdown", onPointerDown, true);
    dom.addEventListener("pointermove", onPointerMove);
    dom.addEventListener("pointerup", onPointerUp, true);

    this.cleanups.push(
      () => window.removeEventListener("keydown", onKeyDown, true),
      () => dom.removeEventListener("pointerdown", onPointerDown, true),
      () => dom.removeEventListener("pointermove", onPointerMove),
      () => dom.removeEventListener("pointerup", onPointerUp, true),
    );
  }

  dispose() {
    this.cancel();
    for (const cleanup of this.cleanups) cleanup();
    this.cleanups.length = 0;
  }

  private arm() {
    this.armed = true;
    this.viewport.renderer.domElement.style.cursor = "crosshair";
  }

  /** Puts the rectangle away and goes back to ordinary clicking. */
  private cancel() {
    this.armed = false;
    this.start = undefined;
    this.viewport.renderer.domElement.style.cursor = "";
    this.frame?.remove();
    this.frame = undefined;
  }

  private draw(x: number, y: number) {
    const start = this.start;
    if (!start) return;
    if (!this.frame) {
      this.frame = document.createElement("div");
      this.frame.style.cssText =
        "position:fixed;pointer-events:none;z-index:40;border:1px dashed var(--foreground);" +
        "background:color-mix(in srgb, var(--foreground) 10%, transparent)";
      document.body.appendChild(this.frame);
    }
    this.frame.style.left = `${Math.min(start.x, x)}px`;
    this.frame.style.top = `${Math.min(start.y, y)}px`;
    this.frame.style.width = `${Math.abs(x - start.x)}px`;
    this.frame.style.height = `${Math.abs(y - start.y)}px`;
  }

  private select(start: { x: number; y: number }, end: PointerEvent) {
    const bounds = this.viewport.renderer.domElement.getBoundingClientRect();
    const a = toNdc(start.x, start.y, bounds);
    const b = toNdc(end.clientX, end.clientY, bounds);
    const inside = idsInRect(this.editor.entries(), this.viewport.camera, rectBetween(a.x, a.y, b.x, b.y));
    this.editor.selectMany(end.shiftKey ? [...this.editor.selectedIds, ...inside] : inside);
  }
}
