import { visibleBounds } from "@/features/viewport3d/visibleBounds";
import { Box3, Vector3, type Camera, type Object3D } from "three";

/** A rectangle of the view in normalized device coordinates (-1 to 1 on both axes, y up). */
export interface NdcRect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const box = new Box3();
const point = new Vector3();

/**
 * Select objects whose world bounding-box centers project inside the rectangle.
 */
export function idsInRect(objects: Iterable<readonly [string, Object3D]>, camera: Camera, rect: NdcRect): string[] {
  camera.updateMatrixWorld();
  const found: string[] = [];
  for (const [id, object] of objects) {
    let visible = true;
    for (let node: Object3D | null = object; node; node = node.parent) {
      if (!node.visible) {
        visible = false;
        break;
      }
    }
    if (!visible) continue;
    object.updateWorldMatrix(true, false);
    visibleBounds(object, box.makeEmpty());
    if (box.isEmpty()) {
      object.getWorldPosition(box.min);
      box.max.copy(box.min);
    }
    box.getCenter(point);
    point.applyMatrix4(camera.matrixWorldInverse);
    if (point.z >= -1e-6) continue;
    point.applyMatrix4(camera.projectionMatrix);
    if (point.z < -1 || point.z > 1) continue;
    if (point.x >= rect.minX && point.x <= rect.maxX && point.y >= rect.minY && point.y <= rect.maxY) found.push(id);
  }
  return found;
}

/** The rectangle between two corners given in any order. */
export function rectBetween(ax: number, ay: number, bx: number, by: number): NdcRect {
  return { minX: Math.min(ax, bx), minY: Math.min(ay, by), maxX: Math.max(ax, bx), maxY: Math.max(ay, by) };
}
