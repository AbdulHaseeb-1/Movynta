import { useEffect } from "react";
import { useAppDispatch } from "@/app/hooks";
import type { Viewport } from "./viewport";
import { isTypingTarget, viewportShortcut } from "./viewportShortcuts";
import { toggleWireframe, toggleXray } from "./viewportSlice";

/** How far one zoom key or button moves the camera. */
export const ZOOM_STEP = 1.35;

export interface ViewportShortcutOptions {
  viewport: Viewport | null;
  /** Moves the camera to show the selection, or the whole scene. Without it, "." and Home do nothing. */
  onFrame?: ((scope: "selection" | "all") => void) | undefined;
}

/**
 * The keys that move around and change how the view is drawn. Mounted once for the workspace, so they
 * keep working in Edit mode, where the object toolbar is hidden.
 */
export function useViewportShortcuts({ viewport, onFrame }: ViewportShortcutOptions): void {
  const dispatch = useAppDispatch();
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isTypingTarget(event.target)) return;
      const shortcut = viewportShortcut(event);
      if (!shortcut) return;
      switch (shortcut.kind) {
        case "view":
          event.preventDefault();
          viewport?.setView(shortcut.preset);
          return;
        case "zoom":
          viewport?.zoomBy(shortcut.direction === "in" ? ZOOM_STEP : 1 / ZOOM_STEP);
          return;
        case "reset":
          viewport?.resetView();
          return;
        case "frame":
          onFrame?.(shortcut.scope);
          return;
        case "toggle-wireframe":
          event.preventDefault();
          dispatch(toggleWireframe());
          return;
        case "toggle-xray":
          // Alt alone would also move focus to the window menu on some systems.
          event.preventDefault();
          dispatch(toggleXray());
          return;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dispatch, viewport, onFrame]);
}
