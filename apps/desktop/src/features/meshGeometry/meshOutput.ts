import { BufferGeometry, Float32BufferAttribute, Uint32BufferAttribute, ShapeUtils, Vector2, Vector3, type BufferAttribute, type InterleavedBufferAttribute } from "three";
import { channels, faceNormal, point, rememberTopology, type PolygonMesh } from "./meshTopology";
import { basis, type Weights } from "./meshWeights";

type Attribute = BufferAttribute | InterleavedBufferAttribute;
function sample(attribute: Attribute, weights: Weights, component: number): number {
  let value = 0;
  for (const [index, weight] of weights) value += attribute.getComponent(index, component) * weight;
  if (!Number.isFinite(value)) throw new Error("Interpolation produced a non-finite attribute");
  return value;
}

/** Cosine between a triangle's normal and the face normal; 0 for a degenerate triangle. Negative means folded. */
function facing(mesh: PolygonMesh, face: readonly number[], triangle: readonly number[], normal: Vector3): number {
  const [a, b, c] = triangle.map((corner) => point(mesh, face[corner]));
  if (!a || !b || !c) return -1;
  const cross = b.clone().sub(a).cross(c.clone().sub(a)); const length = cross.length();
  return length === 0 ? 0 : cross.dot(normal) / length;
}

/**
 * A non-planar quad can fold when projected onto one plane. Split it along the diagonal whose two
 * triangles both face the quad normal; returns undefined when neither diagonal avoids a fold.
 */
function quadDiagonal(mesh: PolygonMesh, face: readonly number[], normal: Vector3): number[][] | undefined {
  const options = [[[0, 1, 2], [0, 2, 3]], [[0, 1, 3], [1, 2, 3]]];
  let best: number[][] | undefined; let bestScore = -Infinity;
  for (const option of options) {
    const score = Math.min(...option.map((triangle) => facing(mesh, face, triangle, normal)));
    if (score > bestScore) { best = option; bestScore = score; }
  }
  return bestScore >= -1e-9 ? best : undefined;
}

/** Triangulate in the dominant plane, preserving winding even for concave control faces. */
export function triangulate(mesh: PolygonMesh, face: readonly number[]): number[][] {
  if (face.length === 3) return [[0, 1, 2]];
  const normal = faceNormal(mesh, face);
  // A valid quad diagonal wins over projection, so skip Earcut when the diagonal already works.
  if (face.length === 4) {
    const diagonal = quadDiagonal(mesh, face, normal);
    if (diagonal) return diagonal;
  }
  const axis = Math.abs(normal.x) > Math.abs(normal.y) ? (Math.abs(normal.x) > Math.abs(normal.z) ? 0 : 2) : (Math.abs(normal.y) > Math.abs(normal.z) ? 1 : 2);
  const contour = face.map((id) => { const p = point(mesh, id); return axis === 0 ? new Vector2(p.y, p.z) : axis === 1 ? new Vector2(p.x, p.z) : new Vector2(p.x, p.y); });
  const projected = ShapeUtils.triangulateShape(contour, []).map((triangle) => {
    const [a, b, c] = triangle.map((corner) => point(mesh, face[corner]));
    return a && b && c && b.clone().sub(a).cross(c.clone().sub(a)).dot(normal) < 0 ? [...triangle].reverse() : triangle;
  });
  if (face.length === 4 && projected.length !== 2) return [];
  return face.length > 4 ? repairFlatTriangles(mesh, face, projected) : projected;
}

/**
 * A triangle whose height is under this fraction of its longest side has a corner in line with the other two. Positions are
 * stored as 32-bit floats, so points put exactly on an edge are only on it to about 1e-7 of its length; a triangle a
 * millionth as high as it is long draws nothing, and the edge checks call it collapsed.
 */
const FLAT_TRIANGLE = 1e-6;

/**
 * Removes triangles with no area. A polygon may have a vertex exactly on a straight edge (a bevel puts one there so the
 * neighbouring face has no gap), and ear clipping then cuts that vertex off as a flat ear: a triangle that draws nothing
 * but that the edit checks rightly call collapsed. Such a triangle (u, v, w) has w on the segment u-v, so it and the
 * triangle across u-v, (v, u, d), together are the triangle u-v-d with w on one edge; splitting it at w gives
 * (w, u, d) and (v, w, d). The triangle count and the winding are unchanged. A flat triangle on the outline of the
 * polygon, or one whose neighbour is also flat, is left as it was.
 */
function repairFlatTriangles(mesh: PolygonMesh, face: readonly number[], triangles: number[][]): number[][] {
  const at = (corner: number): Vector3 | undefined => point(mesh, face[corner]);
  const flat = (triangle: readonly number[]): { u: number; v: number; w: number } | undefined => {
    const [i, j, k] = triangle;
    if (i === undefined || j === undefined || k === undefined) return undefined;
    const a = at(i), b = at(j), c = at(k);
    if (!a || !b || !c) return undefined;
    const lengths = [a.distanceToSquared(b), b.distanceToSquared(c), c.distanceToSquared(a)];
    const longest = Math.max(...lengths);
    const area = b.clone().sub(a).cross(c.clone().sub(a)).lengthSq() / 4;
    if (!(longest > 0) || area > longest * longest * FLAT_TRIANGLE * FLAT_TRIANGLE) return undefined;
    // The long side is opposite the vertex that lies between the other two.
    const side = lengths.indexOf(longest);
    return side === 0 ? { u: i, v: j, w: k } : side === 1 ? { u: j, v: k, w: i } : { u: k, v: i, w: j };
  };
  const result = triangles.map((triangle) => [...triangle]);
  for (let pass = 0; pass < result.length; pass += 1) {
    let changed = false;
    for (let index = 0; index < result.length; index += 1) {
      const triangle = result[index];
      const found = triangle ? flat(triangle) : undefined;
      if (!found) continue;
      const { u, v, w } = found;
      // The triangle across the long side runs that side the other way: v to u.
      const other = result.findIndex((candidate, position) => {
        if (position === index) return false;
        for (let corner = 0; corner < 3; corner += 1) if (candidate[corner] === v && candidate[(corner + 1) % 3] === u) return true;
        return false;
      });
      const neighbour = result[other];
      if (!neighbour) continue;
      const d = neighbour.find((corner) => corner !== u && corner !== v);
      if (d === undefined) continue;
      // Keep the winding of the flat triangle's own order: u -> v is its long side, so the boundary reads v, w, u, d.
      const first = [w, u, d], second = [v, w, d];
      if (flat(first) || flat(second)) continue;
      result[index] = first;
      result[other] = second;
      changed = true;
    }
    if (!changed) break;
  }
  return result;
}

/**
 * Cage vertices whose source samples do not share a normal. A flat-shaded cube corner is hard;
 * a smooth sphere vertex is not. Extrude uses this so new faces keep the authored shading.
 */
export function hardCageVertices(source: BufferGeometry, mesh: PolygonMesh): Set<number> {
  const position = source.getAttribute("position");
  const normal = source.getAttribute("normal");
  const hard = new Set<number>();
  if (!position || !normal || normal.itemSize < 3) return hard;
  source.computeBoundingBox();
  const size = source.boundingBox?.getSize(new Vector3()).length() ?? 1;
  const epsilon = Math.max(size * 1e-5, 1e-8);
  const keyOf = (index: number): string => `${Math.round(position.getX(index) / epsilon)}_${Math.round(position.getY(index) / epsilon)}_${Math.round(position.getZ(index) / epsilon)}`;
  const groups = new Map<string, Vector3>();
  const hardKeys = new Set<string>();
  const direction = new Vector3();
  for (let index = 0; index < position.count; index += 1) {
    direction.fromBufferAttribute(normal, index);
    if (direction.lengthSq() < 1e-12) continue;
    direction.normalize();
    const key = keyOf(index);
    const existing = groups.get(key);
    if (!existing) groups.set(key, direction.clone());
    else if (existing.dot(direction) < 0.999) hardKeys.add(key);
  }
  const data = channels(mesh);
  mesh.positions.forEach((_, vertex) => {
    for (const sourceIndex of data.positions[vertex]?.keys() ?? []) {
      if (!Number.isInteger(sourceIndex) || sourceIndex < 0 || sourceIndex >= position.count) continue;
      if (hardKeys.has(keyOf(sourceIndex))) hard.add(vertex);
    }
  });
  return hard;
}

/**
 * Lets a caller rewrite texture coordinates of render corners before the topology is remembered.
 * `renderCorner(face, corner)` gives the render index of a face corner in a smooth write.
 */
export type CornerUvPatch = (uv: BufferAttribute | InterleavedBufferAttribute, renderCorner: (face: number, corner: number) => number) => void;

/** Writes a mesh and keeps hard edges hard. Smooth vertices stay averaged. */
export function writeShadedGeometry(source: BufferGeometry, mesh: PolygonMesh, patchUv?: CornerUvPatch): BufferGeometry {
  return writeGeometry(source, mesh, false, hardCageVertices(source, mesh), patchUv);
}

/** Render corners are distinct from control vertices, so UV and material seams remain intact. */
export function writeGeometry(source: BufferGeometry, mesh: PolygonMesh, flat: boolean, hardVertices?: ReadonlySet<number>, patchUv?: CornerUvPatch): BufferGeometry {
  const vertices = mesh.faces.reduce((count, face) => count + (flat ? (face.length - 2) * 3 : face.length), 0);
  const attributeSize = Object.values(source.attributes).reduce((sum, attribute) => sum + attribute.itemSize, 0);
  const morphSize = Object.values(source.morphAttributes).flatMap((targets) => targets ?? []).reduce((sum, attribute) => sum + attribute.itemSize, 0);
  if (vertices * (attributeSize + morphSize + 12) * 4 > 128 * 1024 * 1024) throw new Error("Modifier output exceeds the 128 MiB attribute budget");
  const data = channels(mesh); const output = new BufferGeometry();
  const positions: number[] = []; const indices: number[] = []; const vertexIds: number[] = [];
  const renderWeights: Weights[] = []; const geometricWeights: Weights[] = [];
  const controlCorners: Weights[][] = [];
  const firstRender: number[] = [];
  mesh.faces.forEach((face, faceId) => {
    const corners: Weights[] = [];
    const begin = indices.length;
    firstRender.push(vertexIds.length);
    const emit = (corner: number): number => {
      const id = face[corner]; if (id === undefined) throw new Error("Invalid face corner");
      const p = point(mesh, id); const index = vertexIds.length;
      positions.push(p.x, p.y, p.z); vertexIds.push(id);
      renderWeights.push(data.corners[faceId]?.[corner] ?? data.positions[id] ?? basis(id));
      geometricWeights.push(data.positions[id] ?? basis(id));
      corners[corner] ??= basis(index);
      return index;
    };
    const triangles = triangulate(mesh, face);
    if (triangles.length !== face.length - 2) throw new Error("A result face is degenerate or self-intersecting and cannot be triangulated; repair the source mesh or change the modifier settings");
    if (flat) {
      for (const triangle of triangles) for (const corner of triangle) indices.push(emit(corner));
    } else {
      const rendered = face.map((_, corner) => emit(corner));
      for (const triangle of triangles) for (const corner of triangle) { const id = rendered[corner]; if (id !== undefined) indices.push(id); }
    }
    const material = data.materials[faceId] ?? 0; const last = output.groups[output.groups.length - 1];
    if (last && last.materialIndex === material && last.start + last.count === begin) last.count += indices.length - begin;
    else output.addGroup(begin, indices.length - begin, material);
    controlCorners.push(corners);
  });
  if (!positions.every((value) => Number.isFinite(value) && Math.abs(value) <= 3.402823466e38)) throw new Error("Geometry exceeds finite Float32 limits");
  output.setAttribute("position", new Float32BufferAttribute(positions, 3)); output.setIndex(indices);
  for (const [name, attribute] of Object.entries(source.attributes)) {
    if (["position", "normal", "tangent", "skinIndex", "skinWeight"].includes(name)) continue;
    const values = new Float32Array(renderWeights.length * attribute.itemSize);
    renderWeights.forEach((weights, index) => {
      for (let c = 0; c < attribute.itemSize; c += 1) values[index * attribute.itemSize + c] = sample(attribute, weights, c);
    });
    output.setAttribute(name, new Float32BufferAttribute(values, attribute.itemSize));
  }
  // Before the topology is remembered, so the cached signature matches the final texture coordinates.
  const uv = output.getAttribute("uv");
  if (patchUv && uv) patchUv(uv, (face, corner) => (firstRender[face] ?? 0) + corner);
  const skinIndex = source.getAttribute("skinIndex"); const skinWeight = source.getAttribute("skinWeight");
  if (Boolean(skinIndex) !== Boolean(skinWeight)) throw new Error("Skin indices and weights must be supplied together");
  if (skinIndex && skinWeight) {
    const joints: number[] = []; const weights: number[] = [];
    for (const stencil of geometricWeights) {
      const influences = new Map<number, number>();
      for (const [index, coefficient] of stencil) for (let i = 0; i < skinIndex.itemSize; i += 1) {
        const joint = skinIndex.getComponent(index, i); const weight = skinWeight.getComponent(index, i) * coefficient;
        if (!Number.isInteger(joint) || joint < 0) throw new Error("Skin joint indices must be nonnegative integers");
        influences.set(joint, (influences.get(joint) ?? 0) + weight);
      }
      // Rank by magnitude so a negative corrective weight is kept, then restore a unit sum.
      const best = [...influences].filter(([, weight]) => Math.abs(weight) > 1e-10).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 4);
      const total = best.reduce((sum, [, weight]) => sum + weight, 0);
      if (!(Math.abs(total) > 1e-8)) throw new Error("Skin interpolation produced no net influence");
      for (let i = 0; i < 4; i += 1) { joints.push(best[i]?.[0] ?? 0); weights.push((best[i]?.[1] ?? 0) / total); }
    }
    output.setAttribute("skinIndex", new Uint32BufferAttribute(joints, 4)); output.setAttribute("skinWeight", new Float32BufferAttribute(weights, 4));
  }
  output.morphTargetsRelative = source.morphTargetsRelative;
  for (const name of ["position", "normal", "color"] as const) {
    const targets = source.morphAttributes[name];
    if (!targets) continue;
    output.morphAttributes[name] = targets.map((target) => {
      const attribute = new Float32BufferAttribute(geometricWeights.flatMap((weights) => Array.from({ length: target.itemSize }, (_, c) => sample(target, weights, c))), target.itemSize);
      attribute.name = target.name; return attribute;
    });
  }
  recomputeNormals(output, indices, vertexIds, mesh.positions.length, !flat, hardVertices);
  const morphPositions = output.morphAttributes.position;
  if (morphPositions) {
    const base = output.getAttribute("position"); const baseNormals = output.getAttribute("normal");
    output.morphAttributes.normal = morphPositions.map((target) => {
      const temporary = new BufferGeometry();
      const values: number[] = [];
      for (let i = 0; i < target.count; i += 1) for (let c = 0; c < 3; c += 1) values.push(target.getComponent(i, c) + (output.morphTargetsRelative ? base.getComponent(i, c) : 0));
      temporary.setAttribute("position", new Float32BufferAttribute(values, 3)); temporary.setIndex(indices);
      recomputeNormals(temporary, indices, vertexIds, mesh.positions.length, !flat, hardVertices);
      const normal = temporary.getAttribute("normal"); const deltas: number[] = [];
      for (let i = 0; i < normal.count; i += 1) for (let c = 0; c < 3; c += 1) deltas.push(normal.getComponent(i, c) - (output.morphTargetsRelative ? baseNormals.getComponent(i, c) : 0));
      const attribute = new Float32BufferAttribute(deltas, 3); attribute.name = target.name; temporary.dispose(); return attribute;
    });
  }
  if (source.getAttribute("tangent") && output.getAttribute("uv")) output.computeTangents();
  output.computeBoundingBox(); output.computeBoundingSphere();
  const representatives: Weights[] = [];
  vertexIds.forEach((id, index) => { representatives[id] ??= basis(index); });
  // Flat bevels keep a nonindexed render buffer while preserving the polygon cage in metadata.
  if (flat) { output.setIndex(null); }
  rememberTopology(output, {
    positions: mesh.positions, faces: mesh.faces,
    channels: { positions: representatives, corners: controlCorners, materials: data.materials },
    ...(mesh.faceSources ? { faceSources: mesh.faceSources } : {}),
  });
  return output;
}

export function recomputeNormals(geometry: BufferGeometry, indices: number[], vertexIds: number[], count: number, smooth: boolean, hardVertices?: ReadonlySet<number>): void {
  geometry.computeVertexNormals();
  if (!smooth) return;
  const sums = Array.from({ length: count }, () => new Vector3());
  const normals = geometry.getAttribute("normal");
  if (!normals) return;
  const position = geometry.getAttribute("position");
  const pa = new Vector3(); const ab = new Vector3(); const ac = new Vector3();
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i]; const b = indices[i + 1]; const c = indices[i + 2];
    if (a === undefined || b === undefined || c === undefined) continue;
    pa.fromBufferAttribute(position, a);
    const normal = ab.fromBufferAttribute(position, b).sub(pa).cross(ac.fromBufferAttribute(position, c).sub(pa));
    sums[vertexIds[a] ?? -1]?.add(normal);
    sums[vertexIds[b] ?? -1]?.add(normal);
    sums[vertexIds[c] ?? -1]?.add(normal);
  }
  sums.forEach((normal) => normal.normalize());
  vertexIds.forEach((id, index) => {
    if (hardVertices?.has(id)) return;
    const normal = sums[id];
    if (normal && normal.lengthSq() > 1e-12) normals.setXYZ(index, normal.x, normal.y, normal.z);
  });
}
