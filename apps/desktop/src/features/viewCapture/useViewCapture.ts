import { useEffect, useRef, type RefObject } from "react";
import type { Viewport } from "@/features/viewport3d";
import { captureViews } from "./captureViews";
import type { CaptureScene, ViewCaptureHandler } from "./types";

/**
 * A handler the editor connection calls when the assistant asks to look at the scene. It is kept in a ref so
 * the connection, opened once per run, always reaches the viewport that is on screen now.
 */
export function useViewCapture(
  viewport: Viewport | null,
  editor: RefObject<CaptureScene | null>,
): RefObject<ViewCaptureHandler | null> {
  const handler = useRef<ViewCaptureHandler | null>(null);
  useEffect(() => {
    handler.current = viewport
      ? (request, options) => {
          const scene = editor.current;
          if (!scene) throw new Error("The scene is not ready yet");
          return captureViews(viewport, scene, request, options);
        }
      : null;
    return () => {
      handler.current = null;
    };
  }, [viewport, editor]);
  return handler;
}
