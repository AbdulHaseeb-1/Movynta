import { Vector3, type Box3, type OrthographicCamera, type PerspectiveCamera } from "three";

/** A box on the picture, in pixels from the top-left corner. */
export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Where the box lands on the picture. Corners behind the camera are left out, so a box that surrounds the camera
 * is only approximate. Returns null when the whole box is behind the camera. The camera's matrices must be current.
 */
export function projectBounds(
  box: Box3,
  camera: PerspectiveCamera | OrthographicCamera,
  width: number,
  height: number,
): PixelRect | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const corner = new Vector3();
  for (let index = 0; index < 8; index += 1) {
    corner.set(index & 1 ? box.max.x : box.min.x, index & 2 ? box.max.y : box.min.y, index & 4 ? box.max.z : box.min.z);
    const depth = corner.clone().applyMatrix4(camera.matrixWorldInverse).z;
    if (depth >= -camera.near) continue;
    corner.project(camera);
    const x = (corner.x * 0.5 + 0.5) * width;
    const y = (1 - (corner.y * 0.5 + 0.5)) * height;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  if (minX === Infinity) return null;
  return { x: round(minX), y: round(minY), width: round(maxX - minX), height: round(maxY - minY) };
}

/** Whether any part of the rect is inside a picture of this size. */
export function isInFrame(rect: PixelRect | null, width: number, height: number): boolean {
  return rect !== null && rect.x < width && rect.y < height && rect.x + rect.width > 0 && rect.y + rect.height > 0;
}
