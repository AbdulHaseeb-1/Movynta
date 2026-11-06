import { Raycaster, Vector2, type Camera, type Intersection } from "three";
import type { EditorScene } from "@/features/assistant";
import { setCameraRay } from "@/features/viewport3d/cameraRay";
import { accelerateRaycasts } from "./denseRaycast";

const raycaster = new Raycaster();
/** Reused for every object, so a click does not allocate a list per object. */
const hits: Intersection[] = [];

/**
 * The object under a point of the view, or undefined when the point is empty space. `ndc` is the point
 * in normalized device coordinates (-1 to 1 on both axes, y up). A hit on any part of an imported
 * model picks the whole model.
 *
 * Only the nearest hit matters, so the objects are tested one at a time and the closest kept, rather
 * than collecting and sorting every hit in the scene. Dense meshes are tested with a spatial index.
 */
export function pickObjectId(
  editor: EditorScene,
  camera: Camera,
  ndc: Vector2,
): string | undefined {
  setCameraRay(raycaster, ndc, camera);
  let nearest = Infinity;
  let nearestId: string | undefined;
  for (const object of editor.pickables()) {
    accelerateRaycasts(object);
    hits.length = 0;
    raycaster.intersectObject(object, true, hits);
    for (const hit of hits) {
      const depth = hit.point.clone().project(camera).z;
      if (depth < -1 || depth > 1 || hit.distance >= nearest) continue;
      let visible = true;
      for (let node: typeof hit.object | null = hit.object; node; node = node.parent) {
        if (!node.visible) { visible = false; break; }
      }
      if (!visible) continue;
      const id = editor.idOf(hit.object);
      if (id === undefined) continue;
      nearest = hit.distance;
      nearestId = id;
    }
  }
  hits.length = 0;
  return nearestId;
}

/** Every visible hit under the pointer, nearest first, with one entry per editor object. */
export function pickObjectIds(editor: EditorScene, camera: Camera, ndc: Vector2): string[] {
  setCameraRay(raycaster, ndc, camera);
  const distances = new Map<string, number>();
  for (const object of editor.pickables()) {
    accelerateRaycasts(object);
    hits.length = 0;
    raycaster.intersectObject(object, true, hits);
    for (const hit of hits) {
      const depth = hit.point.clone().project(camera).z;
      if (depth < -1 || depth > 1) continue;
      let visible = true;
      for (let node: typeof hit.object | null = hit.object; node; node = node.parent) if (!node.visible) { visible = false; break; }
      if (!visible) continue;
      const id = editor.idOf(hit.object);
      if (id !== undefined && hit.distance < (distances.get(id) ?? Infinity)) distances.set(id, hit.distance);
    }
  }
  hits.length = 0;
  return [...distances].sort((a, b) => a[1] - b[1]).map(([id]) => id);
}

/** A pointer position as normalized device coordinates within `bounds`. */
export function toNdc(
  clientX: number,
  clientY: number,
  bounds: Pick<DOMRect, "left" | "top" | "width" | "height">,
): Vector2 {
  return new Vector2(
    ((clientX - bounds.left) / bounds.width) * 2 - 1,
    -((clientY - bounds.top) / bounds.height) * 2 + 1,
  );
}
