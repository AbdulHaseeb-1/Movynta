import {
  BufferGeometry,
  Float32BufferAttribute,
  Matrix4,
  Vector3,
  type BufferAttribute,
  type InterleavedBufferAttribute,
} from "three";
import { MAX_MESH_OUTPUT_TRIANGLES } from "@movynta/editor-protocol";
import type { Manifold, ManifoldToplevel, Mesh } from "manifold-3d";
import { getManifoldModule, getManifoldModuleSync, setWasmUrl } from "manifold-3d/lib/wasm.js";
import { writeGeometry } from "./meshOutput";
import { assertManifold, faceNormal, readTopology, topology } from "./meshTopology";

export type BooleanOperation = "difference" | "union" | "intersect";

interface PropertyLayout {
  numProp: number;
  uv: number;
  color: number;
  colorSize: number;
}

let loading: Promise<void> | undefined;
let loadError: Error | undefined;

/** Loads the Manifold WASM module once. Evaluation after this stays synchronous. */
export function ensureManifold(): Promise<void> {
  loading ??= loadManifold().catch((error: unknown) => {
    loading = undefined;
    loadError = error instanceof Error ? error : new Error("Boolean solver failed to load");
    throw loadError;
  });
  return loading;
}

async function loadManifold(): Promise<void> {
  if (typeof window !== "undefined") {
    const imported = await import("manifold-3d/manifold.wasm?url");
    setWasmUrl(imported.default);
  }
  await getManifoldModule();
}

function solver(): ManifoldToplevel {
  const api = getManifoldModuleSync();
  if (!api) throw new Error(loadError?.message ?? "Boolean solver is still loading");
  return api;
}

function assertSupported(geometry: BufferGeometry, role: "mesh" | "operand"): void {
  if (geometry.getAttribute("skinIndex") || geometry.getAttribute("skinWeight")) {
    throw new Error("Boolean modifiers on skinned meshes are not supported");
  }
  if ((geometry.morphAttributes.position?.length ?? 0) > 0) {
    throw new Error("Boolean modifiers on morph targets are not supported");
  }
  const position = geometry.getAttribute("position");
  if (!position || position.itemSize !== 3 || position.count === 0) {
    throw new Error(role === "operand" ? "Boolean operand needs 3D positions" : "Mesh needs 3D positions");
  }
}

/** Closed solids only. Non-manifold defects are reported separately from open boundaries. */
function assertClosedSolid(geometry: BufferGeometry): void {
  const cage = readTopology(geometry);
  const graph = topology(cage);
  try {
    assertManifold(cage, graph);
  } catch {
    throw new Error("Boolean needs a manifold solid");
  }
  try {
    assertManifold(cage, graph, true);
  } catch {
    throw new Error("Boolean needs a closed solid without boundary edges");
  }
}

function layoutFor(target: BufferGeometry, operand: BufferGeometry): PropertyLayout {
  const uv = target.getAttribute("uv") ?? operand.getAttribute("uv");
  const color = target.getAttribute("color") ?? operand.getAttribute("color");
  const colorSize = color?.itemSize ?? 0;
  let numProp = 3;
  const uvIndex = uv ? numProp : -1;
  if (uv) numProp += 2;
  const colorIndex = colorSize > 0 ? numProp : -1;
  if (colorSize > 0) numProp += colorSize;
  return { numProp, uv: uvIndex, color: colorIndex, colorSize };
}

function readComponent(
  attribute: BufferAttribute | InterleavedBufferAttribute,
  index: number,
  component: number,
): number {
  const value = attribute.getComponent(index, component);
  return Number.isFinite(value) ? value : 0;
}

interface SolidArrays {
  numProp: number;
  vertProperties: Float32Array;
  triVerts: Uint32Array;
  faceID: Uint32Array;
  mergeFromVert: Uint32Array;
  mergeToVert: Uint32Array;
  runIndex: Uint32Array;
  runOriginalID: Uint32Array;
}

function buildMesh(
  api: ManifoldToplevel,
  geometry: BufferGeometry,
  matrix: Matrix4,
  flip: boolean,
  layout: PropertyLayout,
  originalId: number,
): Mesh {
  const position = geometry.getAttribute("position");
  if (!position) throw new Error("Mesh needs 3D positions");
  const uv = geometry.getAttribute("uv");
  const color = geometry.getAttribute("color");
  const index = geometry.getIndex();
  const triangles = Math.floor((index ? index.count : position.count) / 3);
  const vertProperties = new Float32Array(position.count * layout.numProp);
  const point = new Vector3();
  for (let vertex = 0; vertex < position.count; vertex += 1) {
    point.fromBufferAttribute(position, vertex).applyMatrix4(matrix);
    const offset = vertex * layout.numProp;
    vertProperties[offset] = point.x;
    vertProperties[offset + 1] = point.y;
    vertProperties[offset + 2] = point.z;
    if (layout.uv >= 0 && uv) {
      vertProperties[offset + layout.uv] = readComponent(uv, vertex, 0);
      vertProperties[offset + layout.uv + 1] = readComponent(uv, vertex, 1);
    }
    if (layout.color >= 0 && color) {
      for (let channel = 0; channel < Math.min(layout.colorSize, color.itemSize); channel += 1) {
        vertProperties[offset + layout.color + channel] = readComponent(color, vertex, channel);
      }
    }
  }
  const triVerts = new Uint32Array(triangles * 3);
  const materials = new Int32Array(triangles).fill(-1);
  for (const group of geometry.groups) {
    const first = Math.max(0, Math.ceil(group.start / 3));
    const last = Math.min(triangles, Math.ceil((group.start + group.count) / 3));
    for (let tri = first; tri < last; tri += 1) {
      if (materials[tri] === -1) materials[tri] = group.materialIndex ?? 0;
    }
  }
  for (let tri = 0; tri < triangles; tri += 1) {
    const corners = [0, 1, 2].map((corner) => {
      const element = tri * 3 + corner;
      return index ? index.getX(element) : element;
    });
    if (flip) {
      const first = corners[0];
      corners[0] = corners[1] ?? 0;
      corners[1] = first ?? 0;
    }
    const [a, b, c] = corners;
    if (a === undefined || b === undefined || c === undefined) throw new Error("Invalid triangle");
    triVerts[tri * 3] = a;
    triVerts[tri * 3 + 1] = b;
    triVerts[tri * 3 + 2] = c;
  }
  const mesh = new api.Mesh({
    numProp: layout.numProp,
    vertProperties,
    triVerts,
    faceID: Uint32Array.from(materials, (material) => Math.max(0, material)),
    runIndex: new Uint32Array([0]),
    runOriginalID: new Uint32Array([originalId]),
  });
  mesh.merge();
  return mesh;
}

function asSolid(api: ManifoldToplevel, mesh: Mesh): Manifold {
  try {
    return new api.Manifold(mesh);
  } catch {
    throw new Error("Boolean needs a manifold solid");
  }
}

function copySolid(mesh: Mesh): SolidArrays {
  return {
    numProp: mesh.numProp,
    vertProperties: new Float32Array(mesh.vertProperties),
    triVerts: new Uint32Array(mesh.triVerts),
    faceID: new Uint32Array(mesh.faceID),
    mergeFromVert: new Uint32Array(mesh.mergeFromVert),
    mergeToVert: new Uint32Array(mesh.mergeToVert),
    runIndex: new Uint32Array(mesh.runIndex),
    runOriginalID: new Uint32Array(mesh.runOriginalID),
  };
}

/** Use the solver's seam equivalences. Nearby but distinct vertices must never be welded. */
function solidVertexIds(solid: SolidArrays, count: number): Uint32Array {
  const ids = Uint32Array.from({ length: count }, (_, index) => index);
  const root = (index: number): number => {
    let current = index;
    let parent = ids[current];
    while (parent !== undefined && parent !== current) {
      ids[current] = ids[parent] ?? parent;
      current = parent;
      parent = ids[current];
    }
    return current;
  };
  solid.mergeFromVert.forEach((from, index) => {
    const to = solid.mergeToVert[index];
    if (to === undefined || from >= count || to >= count) throw new Error("Invalid Boolean seam");
    ids[root(from)] = root(to);
  });
  return ids.map((_, index) => root(index));
}

function geometryFromSolid(
  solid: SolidArrays,
  layout: PropertyLayout,
  cutterId: number,
  cutMaterialIndex?: number,
  materialSlots = Infinity,
): BufferGeometry {
  const { numProp, vertProperties, triVerts, faceID, runIndex, runOriginalID } = solid;
  const vertices = vertProperties.length / numProp;
  const position = new Float32Array(vertices * 3);
  const uv = new Float32Array(layout.uv >= 0 ? vertices * 2 : 0);
  const color = new Float32Array(layout.color >= 0 ? vertices * layout.colorSize : 0);
  for (let vertex = 0; vertex < vertices; vertex += 1) {
    const offset = vertex * numProp;
    for (let axis = 0; axis < 3; axis += 1) position[vertex * 3 + axis] = vertProperties[offset + axis] ?? 0;
    if (layout.uv >= 0)
      for (let channel = 0; channel < 2; channel += 1) {
        uv[vertex * 2 + channel] = vertProperties[offset + layout.uv + channel] ?? 0;
      }
    if (layout.color >= 0)
      for (let channel = 0; channel < layout.colorSize; channel += 1) {
        color[vertex * layout.colorSize + channel] = vertProperties[offset + layout.color + channel] ?? 0;
      }
  }
  const carrier = new BufferGeometry();
  carrier.setAttribute("position", new Float32BufferAttribute(position, 3));
  carrier.setIndex(Array.from(triVerts));
  if (uv.length) carrier.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  if (color.length) carrier.setAttribute("color", new Float32BufferAttribute(color, layout.colorSize));
  let run = 0;
  for (let offset = 0; offset < triVerts.length; offset += 3) {
    while (offset >= (runIndex[run + 1] ?? Infinity)) run += 1;
    const sourceMaterial =
      runOriginalID[run] === cutterId && cutMaterialIndex !== undefined ? cutMaterialIndex : (faceID[offset / 3] ?? 0);
    const materialIndex = sourceMaterial < materialSlots ? sourceMaterial : 0;
    const previous = carrier.groups[carrier.groups.length - 1];
    if (previous?.materialIndex === materialIndex) previous.count += 3;
    else carrier.addGroup(offset, 3, materialIndex);
  }
  try {
    const cage = readTopology(carrier, solidVertexIds(solid, vertices));
    const graph = topology(cage);
    assertManifold(cage, graph, true);
    const normals = cage.faces.map((face) => faceNormal(cage, face));
    const hard = new Set<number>();
    for (const [a, b] of graph.edges.values()) {
      const first = a && normals[a.face];
      const second = b && normals[b.face];
      if (a && first && second && first.dot(second) < Math.cos(Math.PI / 6)) {
        hard.add(a.from);
        hard.add(a.to);
      }
    }
    return writeGeometry(carrier, cage, false, hard);
  } finally {
    carrier.dispose();
  }
}
/**
 * Boolean of two solids. `operandToTarget` maps operand-local positions into the target's local space.
 * A negative determinant flips the operand's winding. Both Manifold objects are deleted before returning.
 */
export function applyBoolean(
  target: BufferGeometry,
  operand: BufferGeometry,
  operation: BooleanOperation,
  operandToTarget: Matrix4,
  cutMaterialIndex?: number,
  materialSlots?: number,
): BufferGeometry {
  assertSupported(target, "mesh");
  assertSupported(operand, "operand");
  assertClosedSolid(target);
  assertClosedSolid(operand);
  const api = solver();
  const layout = layoutFor(target, operand);
  const flip = operandToTarget.determinant() < 0;
  const solids: Manifold[] = [];
  const targetId = api.Manifold.reserveIDs(2);
  const cutterId = targetId + 1;
  try {
    const left = asSolid(api, buildMesh(api, target, new Matrix4(), false, layout, targetId));
    solids.push(left);
    const right = asSolid(api, buildMesh(api, operand, operandToTarget, flip, layout, cutterId));
    solids.push(right);
    const result =
      operation === "union"
        ? left.add(right)
        : operation === "intersect"
          ? left.intersect(right)
          : left.subtract(right);
    solids.push(result);
    if (result.isEmpty() || result.numTri() === 0) throw new Error("The boolean removed the entire mesh");
    if (result.numTri() > MAX_MESH_OUTPUT_TRIANGLES)
      throw new Error(`Result exceeds the ${MAX_MESH_OUTPUT_TRIANGLES}-triangle geometry limit`);
    return geometryFromSolid(copySolid(result.getMesh()), layout, cutterId, cutMaterialIndex, materialSlots);
  } finally {
    for (const solid of solids) solid.delete();
  }
}
