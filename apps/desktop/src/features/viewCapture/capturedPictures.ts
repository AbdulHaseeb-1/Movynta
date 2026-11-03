import type { CapturedImage } from "@movynta/editor-protocol";

/** One picture the assistant looked at, ready to show in the chat. */
export interface GalleryImage {
  /** Tells this picture from the others of its capture, even when two views share a label. */
  id: string;
  label: string;
  /** A data: URL the picture can be shown from. */
  src: string;
  width: number;
  height: number;
  /** How the picture was taken, in words. */
  camera: string;
}

/** How many captures are kept. Older ones are forgotten, so pictures do not pile up over a long session. */
export const MAX_REMEMBERED_CAPTURES = 12;

const captures = new Map<string, readonly GalleryImage[]>();

function describeCamera(image: CapturedImage): string {
  const { camera } = image;
  if (camera.projection === "orthographic") return "Orthographic view";
  return camera.fov === null ? "Perspective view" : `Perspective view, ${Math.round(camera.fov)} degree field of view`;
}

/**
 * Keeps the pictures the assistant was just given, under the id the backend named the capture with, so the chat
 * can show what it saw. Nothing leaves the editor: the backend's events carry only the id and the names of the views.
 */
export function rememberCapture(captureId: string, images: readonly CapturedImage[]): void {
  const drawn = images
    .filter((image) => image.data.length > 0)
    .map((image, position) => ({
      id: `${captureId}:${position}`,
      label: image.label,
      src: `data:${image.mediaType};base64,${image.data}`,
      width: image.width,
      height: image.height,
      camera: describeCamera(image),
    }));
  if (drawn.length === 0) return;
  captures.delete(captureId);
  captures.set(captureId, drawn);
  for (const oldest of captures.keys()) {
    if (captures.size <= MAX_REMEMBERED_CAPTURES) break;
    captures.delete(oldest);
  }
}

/** The pictures of a capture, or undefined if it was never drawn here or has been forgotten. */
export function recallCapture(captureId: string): readonly GalleryImage[] | undefined {
  return captures.get(captureId);
}

/** Forgets every capture, for tests. */
export function forgetCaptures(): void {
  captures.clear();
}
