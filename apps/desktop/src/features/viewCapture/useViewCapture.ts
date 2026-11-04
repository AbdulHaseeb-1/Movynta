import { useEffect, useRef, type RefObject } from "react";
import { Light } from "three";
import type { Viewport } from "@/features/viewport3d";
import { captureViews } from "./captureViews";
import type { EditorScene } from "@/features/assistant";
import type { ViewCaptureHandler } from "./types";

/**
 * A handler the editor connection calls when the assistant asks to look at the scene. It is kept in a ref so
 * the connection, opened once per run, always reaches the viewport that is on screen now.
 */
export function useViewCapture(
  viewport: Viewport | null,
  editor: RefObject<EditorScene | null>,
): RefObject<ViewCaptureHandler | null> {
  const handler = useRef<ViewCaptureHandler | null>(null);
  useEffect(() => {
    handler.current = viewport
      ? (request, options) => {
          const scene = editor.current;
          if (!scene) throw new Error("The scene is not ready yet");
          const candidate = options.candidate;
          if (candidate) {
            return scene.withProposalPreview(candidate.proposalId, candidate.revision, candidate.commands, (world, isolated) => {
              for (const child of viewport.scene.children) {
                if (child instanceof Light) world.add(child.clone());
              }
              const result = captureViews({ ...viewport, scene: world }, isolated, request, options);
              return {
                ...result,
                images: result.images.map((image) => ({ ...image, label: `Proposed · ${image.label}`.slice(0, 60) })),
              };
            });
          }
          return captureViews(viewport, scene, request, options);
        }
      : null;
    return () => {
      handler.current = null;
    };
  }, [viewport, editor]);
  return handler;
}
