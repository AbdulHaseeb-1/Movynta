import { PerspectiveCamera, type Object3D, type Scene, type WebGLRenderer } from "three";
import type { Viewport } from "@/features/viewport3d";

export interface StubViewport {
  viewport: Viewport;
  /** Runs every frame listener once, as one frame of the render loop would. */
  frame: () => void;
}

/**
 * The parts of a viewport that the editing code touches, without a canvas or a GPU: a camera at (0, 0, 6),
 * a canvas stand-in that takes event listeners, and the frame listeners. `onOutline` receives the objects
 * the selection outline would be drawn around.
 */
export function stubViewport(scene: Scene, onOutline: (objects: readonly Object3D[]) => void = () => undefined): StubViewport {
  const listeners = new Set<(delta: number) => void>();
  const dom = Object.assign(new EventTarget(), {
    style: {} as Record<string, string>,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    setPointerCapture: () => undefined,
    releasePointerCapture: () => undefined,
    ownerDocument: { addEventListener: () => undefined, removeEventListener: () => undefined },
  });
  const camera = new PerspectiveCamera(45, 4 / 3, 0.1, 1000);
  camera.position.set(0, 0, 6);
  camera.updateMatrixWorld(true);
  const viewport = {
    scene,
    camera,
    renderer: { domElement: dom } as unknown as WebGLRenderer,
    controls: { enabled: true },
    addFrameListener: (listener: (delta: number) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setOutlinedObjects: onOutline,
  } as unknown as Viewport;
  return { viewport, frame: () => listeners.forEach((listener) => listener(0.016)) };
}
