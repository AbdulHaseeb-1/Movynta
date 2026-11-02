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
 * The ids of the objects that lie in a rectangle of the view: those whose center, the center of their
 * bounding box, falls inside it. Objects behind the camera and objects with nothing to measure, which
 * are placed by their origin, are handled too. Measuring a model walks its parts, so the cost follows
 * the size of the scene; it is paid once, when the rectangle is released.
 */
export function idsInRect(
  objects: Iterable<readonly [string, Object3D]>,
  camera: Camera,
  rect: NdcRect,
): string[] {
  camera.updateMatrixWorld();
  const found: string[] = [];
  for (const [id, object] of objects) {
    object.updateWorldMatrix(true, false);
    box.makeEmpty().expandByObject(object);
    if (box.isEmpty()) object.getWorldPosition(point);
    else box.getCenter(point);
    // Looking down -z in view space; anything at or past the camera's plane has no place on screen.
    point.applyMatrix4(camera.matrixWorldInverse);
    if (point.z >= 0) continue;
    point.applyMatrix4(camera.projectionMatrix);
    if (point.x >= rect.minX && point.x <= rect.maxX && point.y >= rect.minY && point.y <= rect.maxY) found.push(id);
  }
  return found;
}

/** The rectangle between two corners given in any order. */
export function rectBetween(ax: number, ay: number, bx: number, by: number): NdcRect {
  return { minX: Math.min(ax, bx), minY: Math.min(ay, by), maxX: Math.max(ax, bx), maxY: Math.max(ay, by) };
}
