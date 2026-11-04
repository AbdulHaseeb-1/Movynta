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
 * Select objects whose projected world bounding boxes overlap the rectangle.
 */
export function idsInRect(
  objects: Iterable<readonly [string, Object3D]>,
  camera: Camera,
  rect: NdcRect,
): string[] {
  camera.updateMatrixWorld();
  const found: string[] = [];
  for (const [id, object] of objects) {
    let visible = true;
    for (let node: Object3D | null = object; node; node = node.parent) {
      if (!node.visible) { visible = false; break; }
    }
    if (!visible) continue;
    object.updateWorldMatrix(true, false);
    box.makeEmpty().expandByObject(object);
    if (box.isEmpty()) { object.getWorldPosition(box.min); box.max.copy(box.min); }
    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
    for (let corner = 0; corner < 8; corner += 1) {
      point.set(corner & 1 ? box.max.x : box.min.x, corner & 2 ? box.max.y : box.min.y, corner & 4 ? box.max.z : box.min.z);
      point.applyMatrix4(camera.matrixWorldInverse);
      if (point.z >= -1e-6) continue;
      point.applyMatrix4(camera.projectionMatrix);
      minX = Math.min(minX, point.x); minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x); maxY = Math.max(maxY, point.y);
    }
    if (minX <= rect.maxX && maxX >= rect.minX && minY <= rect.maxY && maxY >= rect.minY) found.push(id);
  }
  return found;
}

/** The rectangle between two corners given in any order. */
export function rectBetween(ax: number, ay: number, bx: number, by: number): NdcRect {
  return { minX: Math.min(ax, bx), minY: Math.min(ay, by), maxX: Math.max(ax, bx), maxY: Math.max(ay, by) };
}
