import {
  BackSide,
  BufferAttribute,
  FrontSide,
  Matrix4,
  Mesh,
  Ray,
  Vector3,
  type BufferGeometry,
  type Intersection,
  type Object3D,
  type Raycaster,
} from "three";
import { isMesh } from "@/lib/three";

/** Meshes with fewer triangles than this are fast enough for three.js's own ray test. */
export const DENSE_TRIANGLES = 20_000;
/** Triangles per group. A ray only tests the triangles of the groups whose box it crosses. */
const CHUNK_TRIANGLES = 128;

interface ChunkIndex {
  /** Six numbers per group: min x, y, z, then max x, y, z, in the mesh's own space. */
  boxes: Float32Array;
  chunks: number;
  triangles: number;
  positionVersion: number;
  indexVersion: number;
}

const indexes = new WeakMap<BufferGeometry, ChunkIndex | null>();
const patched = new WeakSet<Mesh>();

const inverse = new Matrix4();
const localRay = new Ray();
const a = new Vector3();
const b = new Vector3();
const c = new Vector3();
const point = new Vector3();
const bestPoint = new Vector3();
const worldPoint = new Vector3();

function positionOf(geometry: BufferGeometry): BufferAttribute | undefined {
  const position = geometry.getAttribute("position");
  return position instanceof BufferAttribute && position.itemSize === 3 ? position : undefined;
}

function usesMorph(mesh: Mesh): boolean {
  const influences = mesh.morphTargetInfluences;
  const targets = mesh.geometry.morphAttributes.position;
  if (!influences || !targets || targets.length === 0) return false;
  return influences.some((influence) => influence !== 0);
}

/** A triangle whose first corner lies on the same draw-range steps three.js walks. */
function inDrawRange(geometry: BufferGeometry, elementCount: number, triangle: number): boolean {
  const start = Math.max(0, geometry.drawRange.start);
  const end = Math.min(elementCount, geometry.drawRange.start + geometry.drawRange.count);
  const corner = triangle * 3;
  return corner >= start && corner < end && (corner - start) % 3 === 0;
}

/** Groups the triangles in file order and boxes each group. Rebuilt when positions or indices change. */
function indexOf(geometry: BufferGeometry, minimumTriangles = DENSE_TRIANGLES): ChunkIndex | null {
  const position = positionOf(geometry);
  const cached = indexes.get(geometry);
  const positionVersion = position?.version ?? -1;
  const indexVersion = geometry.getIndex()?.version ?? 0;
  if (cached && cached.positionVersion === positionVersion && cached.indexVersion === indexVersion) return cached;
  if (cached === null && minimumTriangles >= DENSE_TRIANGLES) return null;
  const indices = geometry.getIndex();
  const triangles = indices ? indices.count / 3 : position ? position.count / 3 : 0;
  if (!position || triangles < minimumTriangles) {
    indexes.set(geometry, null);
    return null;
  }
  const chunks = Math.ceil(triangles / CHUNK_TRIANGLES);
  const boxes = new Float32Array(chunks * 6);
  const array = position.array;
  for (let chunk = 0; chunk < chunks; chunk += 1) {
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    const first = chunk * CHUNK_TRIANGLES * 3;
    const last = Math.min(triangles * 3, first + CHUNK_TRIANGLES * 3);
    for (let corner = first; corner < last; corner += 1) {
      const vertex = (indices ? indices.getX(corner) : corner) * 3;
      const x = array[vertex] ?? 0;
      const y = array[vertex + 1] ?? 0;
      const z = array[vertex + 2] ?? 0;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    boxes.set([minX, minY, minZ, maxX, maxY, maxZ], chunk * 6);
  }
  const built = { boxes, chunks, triangles, positionVersion, indexVersion };
  indexes.set(geometry, built);
  return built;
}

/** Whether the ray crosses the box in front of `limit`: the standard slab test, without allocating. */
function crosses(
  boxes: Float32Array,
  offset: number,
  ox: number,
  oy: number,
  oz: number,
  ix: number,
  iy: number,
  iz: number,
  limit: number,
): boolean {
  let near = 0;
  let far = limit;
  for (let axis = 0; axis < 3; axis += 1) {
    const origin = axis === 0 ? ox : axis === 1 ? oy : oz;
    const inverseDirection = axis === 0 ? ix : axis === 1 ? iy : iz;
    const t1 = ((boxes[offset + axis] ?? 0) - origin) * inverseDirection;
    const t2 = ((boxes[offset + 3 + axis] ?? 0) - origin) * inverseDirection;
    near = Math.max(near, Math.min(t1, t2));
    far = Math.min(far, Math.max(t1, t2));
    if (near > far) return false;
  }
  return true;
}

/**
 * Finds where the ray first meets this mesh, like `Mesh.raycast`, but testing only the triangle groups
 * the ray crosses. A model of hundreds of thousands of triangles is then tested by a few thousand.
 */
function raycastDense(this: Mesh, raycaster: Raycaster, intersects: Intersection[]): void {
  const geometry = this.geometry;
  const material = this.material;
  const index = indexOf(geometry);
  const position = positionOf(geometry);
  if (!index || !position || Array.isArray(material) || usesMorph(this)) {
    Mesh.prototype.raycast.call(this, raycaster, intersects);
    return;
  }
  inverse.copy(this.matrixWorld).invert();
  localRay.copy(raycaster.ray).applyMatrix4(inverse);
  const { origin, direction } = localRay;
  const ix = 1 / direction.x;
  const iy = 1 / direction.y;
  const iz = 1 / direction.z;
  const array = position.array;
  const indices = geometry.getIndex();
  const elementCount = indices ? indices.count : position.count;
  const side = material.side;
  // The nearest accepted hit. A hit outside near/far must not hide a farther one that is in range.
  let best = Infinity;
  let bestTriangle = -1;
  const bestNormal = new Vector3();
  let limit = Infinity;
  for (let chunk = 0; chunk < index.chunks; chunk += 1) {
    if (!crosses(index.boxes, chunk * 6, origin.x, origin.y, origin.z, ix, iy, iz, limit)) continue;
    const first = chunk * CHUNK_TRIANGLES;
    const last = Math.min(index.triangles, first + CHUNK_TRIANGLES);
    for (let triangle = first; triangle < last; triangle += 1) {
      if (!inDrawRange(geometry, elementCount, triangle)) continue;
      const i0 = (indices ? indices.getX(triangle * 3) : triangle * 3) * 3;
      const i1 = (indices ? indices.getX(triangle * 3 + 1) : triangle * 3 + 1) * 3;
      const i2 = (indices ? indices.getX(triangle * 3 + 2) : triangle * 3 + 2) * 3;
      a.set(array[i0] ?? 0, array[i0 + 1] ?? 0, array[i0 + 2] ?? 0);
      b.set(array[i1] ?? 0, array[i1 + 1] ?? 0, array[i1 + 2] ?? 0);
      c.set(array[i2] ?? 0, array[i2 + 1] ?? 0, array[i2 + 2] ?? 0);
      // The same facing rules as three.js: the back side tests the triangle reversed.
      const hit =
        side === BackSide
          ? localRay.intersectTriangle(c, b, a, true, point)
          : localRay.intersectTriangle(a, b, c, side === FrontSide, point);
      if (!hit) continue;
      worldPoint.copy(point).applyMatrix4(this.matrixWorld);
      const distance = raycaster.ray.origin.distanceTo(worldPoint);
      if (distance < raycaster.near || distance > raycaster.far || distance >= best) continue;
      best = distance;
      bestTriangle = triangle;
      bestNormal.subVectors(c, b).cross(new Vector3().subVectors(a, b)).normalize();
      limit = origin.distanceTo(point);
      bestPoint.copy(worldPoint);
    }
  }
  if (best === Infinity) return;
  const first = bestTriangle * 3;
  intersects.push({
    distance: best,
    point: bestPoint.clone(),
    object: this,
    faceIndex: bestTriangle,
    face: {
      a: indices ? indices.getX(first) : first,
      b: indices ? indices.getX(first + 1) : first + 1,
      c: indices ? indices.getX(first + 2) : first + 2,
      normal: bestNormal,
      materialIndex: 0,
    },
  });
}

/**
 * Makes ray tests against `root` and its parts fast for dense meshes. Safe to call on every click: a
 * mesh is changed once, and only if it is dense, a plain mesh with its own geometry and one material.
 */
export function accelerateRaycasts(root: Object3D, minimumTriangles = DENSE_TRIANGLES): void {
  root.traverse((node) => {
    if (!isMesh(node) || patched.has(node) || "isSkinnedMesh" in node || "isInstancedMesh" in node) return;
    if (indexOf(node.geometry, minimumTriangles) !== null) {
      patched.add(node);
      node.raycast = raycastDense;
    }
  });
}
