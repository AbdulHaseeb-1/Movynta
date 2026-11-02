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

/** Meshes with fewer triangles than this are fast enough for three.js's own ray test. */
export const DENSE_TRIANGLES = 20_000;
/** Triangles per group. A ray only tests the triangles of the groups whose box it crosses. */
const CHUNK_TRIANGLES = 128;

interface ChunkIndex {
  /** Six numbers per group: min x, y, z, then max x, y, z, in the mesh's own space. */
  boxes: Float32Array;
  chunks: number;
  triangles: number;
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

function isMesh(node: Object3D): node is Mesh {
  return node instanceof Mesh;
}

function positionOf(geometry: BufferGeometry): BufferAttribute | undefined {
  const position = geometry.getAttribute("position");
  return position instanceof BufferAttribute && position.itemSize === 3 ? position : undefined;
}

/** Groups the triangles in file order and boxes each group. Once per geometry, then reused. */
function indexOf(geometry: BufferGeometry): ChunkIndex | null {
  const cached = indexes.get(geometry);
  if (cached !== undefined) return cached;
  const position = positionOf(geometry);
  const indices = geometry.getIndex();
  const triangles = indices ? indices.count / 3 : position ? position.count / 3 : 0;
  if (!position || triangles < DENSE_TRIANGLES) {
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
  const built = { boxes, chunks, triangles };
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
  if (!index || !position || Array.isArray(material)) {
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
  const side = material.side;
  // The nearest hit so far, as a distance along the ray, which also bounds which groups are worth testing.
  let best = Infinity;
  for (let chunk = 0; chunk < index.chunks; chunk += 1) {
    if (!crosses(index.boxes, chunk * 6, origin.x, origin.y, origin.z, ix, iy, iz, best)) continue;
    const first = chunk * CHUNK_TRIANGLES;
    const last = Math.min(index.triangles, first + CHUNK_TRIANGLES);
    for (let triangle = first; triangle < last; triangle += 1) {
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
      const distance = origin.distanceTo(point);
      if (distance < best) {
        best = distance;
        bestPoint.copy(point);
      }
    }
  }
  if (best === Infinity) return;
  const world = bestPoint.applyMatrix4(this.matrixWorld);
  const distance = raycaster.ray.origin.distanceTo(world);
  if (distance < raycaster.near || distance > raycaster.far) return;
  intersects.push({ distance, point: world.clone(), object: this });
}

/**
 * Makes ray tests against `root` and its parts fast for dense meshes. Safe to call on every click: a
 * mesh is changed once, and only if it is dense, a plain mesh with its own geometry and one material.
 */
export function accelerateRaycasts(root: Object3D): void {
  root.traverse((node) => {
    if (!isMesh(node) || patched.has(node) || "isSkinnedMesh" in node || "isInstancedMesh" in node) return;
    patched.add(node);
    if (indexOf(node.geometry) !== null) node.raycast = raycastDense;
  });
}
