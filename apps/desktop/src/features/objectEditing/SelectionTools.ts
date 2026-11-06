import type { EditorScene } from "@/features/assistant";
import type { Viewport } from "@/features/viewport3d";
import { combineSelection, selectionOperation } from "@/features/viewport3d/selectionOperation";
import { idsInRect, rectBetween } from "./boxSelect";
import type { GizmoView } from "./ObjectGizmo";
import { pickObjectId, toNdc } from "./picking";

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
 * nothing, and B lets you drag a rectangle round the objects to select. In Select mode, dragging
 * empty space starts a rectangle directly; Space-drag remains navigation. Shift keeps the selection
 * and adds to it. Shift-click, which adds one object at a time, is in the {@link ObjectGizmo}, next to
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
  private navigationHeld = false;
  private start: { x: number; y: number } | undefined;

  constructor(viewport: Viewport, editor: EditorScene, view: GizmoView) {
    this.viewport = viewport;
    this.editor = editor;
    this.view = view;
    const dom = viewport.renderer.domElement;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === " " && !isTypingTarget(event.target)) this.navigationHeld = true;
      if (isTypingTarget(event.target) || event.ctrlKey || event.metaKey || event.repeat) return;
      if (event.key === "Escape" && this.armed) {
        // The first Escape puts the rectangle away; it must not also clear the selection.
        event.stopImmediatePropagation();
        this.cancel();
        return;
      }
      if (!this.view.enabled()) return;
      // With Alt held some layouts (macOS) type another character, so the physical key decides for A.
      const key = event.altKey && event.code === "KeyA" ? "a" : event.key.toLowerCase();
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
      if (!this.view.enabled()) { if (this.armed || this.start) this.cancel(); return; }
      if (!this.armed) {
        if (event.button !== 0 || this.navigationHeld || !this.view.enabled() || this.view.tool() !== "select") return;
        const point = toNdc(event.clientX, event.clientY, dom.getBoundingClientRect());
        if (pickObjectId(this.editor, viewport.camera, point) !== undefined) return;
        this.arm();
      }
      event.stopImmediatePropagation();
      event.preventDefault();
      if (event.button !== 0) {
        this.cancel();
        return;
      }
      this.start = { x: event.clientX, y: event.clientY };
      dom.setPointerCapture(event.pointerId);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (this.start && (Math.abs(event.clientX - this.start.x) >= MIN_BOX_PX || Math.abs(event.clientY - this.start.y) >= MIN_BOX_PX)) this.draw(event.clientX, event.clientY, event);
    };
    const onPointerUp = (event: PointerEvent) => {
      const start = this.start;
      if (!start) return;
      if (!this.view.enabled()) { this.cancel(); return; }
      event.stopImmediatePropagation();
      if (dom.hasPointerCapture(event.pointerId)) dom.releasePointerCapture(event.pointerId);
      const wide = Math.abs(event.clientX - start.x) >= MIN_BOX_PX || Math.abs(event.clientY - start.y) >= MIN_BOX_PX;
      if (wide) this.select(start, event);
      else if (!event.shiftKey && !event.altKey) this.editor.select(null);
      this.cancel();
    };
    const onPointerCancel = () => this.cancel();
    const onKeyUp = (event: KeyboardEvent) => { if (event.key === " ") this.navigationHeld = false; };
    const onBlur = () => { this.navigationHeld = false; this.cancel(); };
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    dom.addEventListener("pointerdown", onPointerDown, true);
    dom.addEventListener("pointermove", onPointerMove);
    dom.addEventListener("pointerup", onPointerUp, true);
    dom.addEventListener("pointercancel", onPointerCancel);
    dom.addEventListener("lostpointercapture", onPointerCancel);

    this.cleanups.push(
      () => window.removeEventListener("keydown", onKeyDown, true),
      () => window.removeEventListener("keyup", onKeyUp),
      () => window.removeEventListener("blur", onBlur),
      () => dom.removeEventListener("pointerdown", onPointerDown, true),
      () => dom.removeEventListener("pointermove", onPointerMove),
      () => dom.removeEventListener("pointerup", onPointerUp, true),
      () => dom.removeEventListener("pointercancel", onPointerCancel),
      () => dom.removeEventListener("lostpointercapture", onPointerCancel),
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

  private draw(x: number, y: number, modifiers: PointerEvent) {
    const start = this.start;
    if (!start) return;
    if (!this.frame) {
      this.frame = document.createElement("div");
      this.frame.style.cssText =
        "position:fixed;pointer-events:none;z-index:40;border:1px solid var(--foreground);" +
        "background:color-mix(in srgb, var(--foreground) 10%, transparent)";
      document.body.appendChild(this.frame);
    }
    this.frame.textContent = ` ${selectionOperation(modifiers)} `;
    this.frame.style.color = "var(--foreground)";
    this.frame.style.fontSize = "11px";
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
    this.editor.selectMany(combineSelection(this.editor.selectedIds, inside, selectionOperation(end)));
  }
}
