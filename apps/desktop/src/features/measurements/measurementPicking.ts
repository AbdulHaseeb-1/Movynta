import { Plane, Raycaster, Vector2, Vector3, type Object3D } from "three";
import type { EditorScene } from "@/features/assistant";
import type { Viewport } from "@/features/viewport3d";
import { accelerateRaycasts } from "@/features/objectEditing/denseRaycast";
import { isMesh } from "@/lib/three";

/** What a measurement point snaps to: the surface, a vertex or the grid. */
export type MeasurementSnap = "surface" | "vertex" | "grid";

/** Shows a crosshair over the viewport while a measurement point is picked. Returns a function that restores the cursor. */
export function measurementCursor(viewport: Viewport): () => void {
  const element = viewport.renderer.domElement;
  const previous = element.style.cursor;
  element.style.cursor = "crosshair";
  return () => {
    element.style.cursor = previous;
  };
}

/** Pick the visible surface first so vertex snapping follows the surface under the pointer. */
export function pickMeasurementPoint(
  viewport: Viewport,
  scene: EditorScene,
  x: number,
  y: number,
  snap: MeasurementSnap,
): Vector3 | null {
  const rect = viewport.renderer.domElement.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  const ray = new Raycaster();
  viewport.camera.updateMatrixWorld();
  ray.setFromCamera(
    new Vector2(((x - rect.left) / rect.width) * 2 - 1, 1 - ((y - rect.top) / rect.height) * 2),
    viewport.camera,
  );
  if (snap === "grid") {
    const grid = ray.ray.intersectPlane(new Plane(new Vector3(0, 1, 0), 0), new Vector3());
    return grid ? grid.set(Math.round(grid.x), 0, Math.round(grid.z)) : null;
  }
  viewport.scene.updateMatrixWorld(true);
  let best = Infinity;
  let chosen: Vector3 | null = null;
  for (const root of scene.pickables()) {
    accelerateRaycasts(root);
    for (const hit of ray.intersectObject(root, true)) {
      let visible = true;
      for (let node: Object3D | null = hit.object; node; node = node.parent) if (!node.visible) visible = false;
      if (!visible || hit.distance >= best) continue;
      best = hit.distance;
      chosen = hit.point.clone();
      if (snap !== "vertex" || !hit.face || !isMesh(hit.object)) continue;
      let nearest = Infinity;
      for (const index of [hit.face.a, hit.face.b, hit.face.c]) {
        const candidate = hit.object.getVertexPosition(index, new Vector3()).applyMatrix4(hit.object.matrixWorld);
        const projected = candidate.clone().project(viewport.camera);
        const distance = Math.hypot(
          rect.left + ((projected.x + 1) * rect.width) / 2 - x,
          rect.top + ((1 - projected.y) * rect.height) / 2 - y,
        );
        if (distance < nearest) {
          nearest = distance;
          chosen = candidate;
        }
      }
    }
  }
  return chosen;
}
