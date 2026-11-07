import { Vector3, type BufferGeometry } from "three";
import { MAX_MESH_OUTPUT_TRIANGLES, type MeshModifierSpec } from "@movynta/editor-protocol";
import { channels, edgeKey, point, readTopology, topology, type PolygonMesh } from "./meshTopology";
import { topologyResult } from "./meshTopologyEdit";
import { writeShadedGeometry } from "./meshOutput";
import { blend, type Weights } from "./meshWeights";
import { isConvex } from "./meshSubdivision";

type Repetition = Extract<MeshModifierSpec, { kind: "array" | "mirror" }>;
function checkSource(source: BufferGeometry) {
  if (
    (source.morphAttributes.position?.length ?? 0) > 0 ||
    source.getAttribute("skinIndex") ||
    source.getAttribute("skinWeight")
  )
    throw new Error(
      "Array/mirror modifiers do not yet support skin or morph deformation; duplicate the object hierarchy instead",
    );
}
/** Applies one array or mirror entry to a geometry, copying it along an axis or across a plane. */
export function repeatGeometry(source: BufferGeometry, entry: Repetition, startsAtBase: boolean): BufferGeometry {
  checkSource(source);
  const mesh = readTopology(source),
    data = channels(mesh);
  const triangles = mesh.faces.reduce((sum, face) => sum + face.length - 2, 0);
  if (triangles * (entry.kind === "array" ? entry.count : 2) > MAX_MESH_OUTPUT_TRIANGLES)
    throw new Error("Repetition exceeds the geometry output budget");
  const output =
    entry.kind === "array"
      ? arrayMesh(mesh, entry.count, entry.offset, startsAtBase)
      : mirrorMesh(mesh, entry, startsAtBase);
  if (!output.channels) throw new Error("Missing repeated attributes");
  // Ensure even an identity array carries the same independently interpolated material/UV channels.
  if (!data.positions.length) throw new Error("Repetition needs a nonempty mesh");
  return writeShadedGeometry(source, output);
}

/** Makes the copies of a mesh for an array entry, spaced by its offset. */
export function arrayMesh(
  mesh: PolygonMesh,
  count: number,
  offset: readonly number[],
  startsAtBase = true,
): PolygonMesh {
  if (
    !Number.isInteger(count) ||
    count < 1 ||
    count > 64 ||
    (count > 1 && !offset.some((value) => Math.abs(value) > 1e-9))
  )
    throw new Error("Use 1–64 array instances and a nonzero offset");
  if (mesh.faces.reduce((sum, face) => sum + face.length - 2, 0) * count > MAX_MESH_OUTPUT_TRIANGLES)
    throw new Error("Array exceeds the geometry output budget");
  const data = channels(mesh),
    positions: Vector3[] = [],
    faces: number[][] = [],
    corners: Weights[][] = [],
    weights: Weights[] = [],
    materials: number[] = [],
    sources: number[] = [];
  const delta = new Vector3().fromArray(offset);
  for (let copy = 0; copy < count; copy++) {
    const base = positions.length;
    mesh.positions.forEach((p, id) => {
      positions.push(p.clone().addScaledVector(delta, copy));
      weights.push(data.positions[id] ?? new Map());
    });
    mesh.faces.forEach((face, id) => {
      faces.push(face.map((vertex) => vertex + base));
      corners.push(data.corners[id] ?? []);
      materials.push(data.materials[id] ?? 0);
      sources.push(startsAtBase ? id : (mesh.faceSources?.[id] ?? -1));
    });
  }
  return { positions, faces, channels: { positions: weights, corners, materials }, faceSources: sources };
}

/** Makes the mirrored copy of a mesh across its mirror plane. */
export function mirrorMesh(
  mesh: PolygonMesh,
  entry: Extract<Repetition, { kind: "mirror" }>,
  startsAtBase = true,
): PolygonMesh {
  const axis = { x: 0, y: 1, z: 2 }[entry.axis],
    sign = entry.keepSide === "positive" ? 1 : -1;
  const data = channels(mesh),
    positions: Vector3[] = [],
    weights: Weights[] = [],
    original = new Map<number, number>();
  const graph = topology(mesh);
  const faces: number[][] = [],
    corners: Weights[][] = [],
    materials: number[] = [],
    sources: number[] = [];
  const crossing = new Map<string, number>();
  const distance = (id: number) => (point(mesh, id).getComponent(axis) - entry.origin) * sign;
  const addOriginal = (id: number) => {
    const known = original.get(id);
    if (known !== undefined) return known;
    const p = point(mesh, id).clone();
    if (Math.abs(distance(id)) <= entry.mergeDistance) p.setComponent(axis, entry.origin);
    const next = positions.length;
    positions.push(p);
    weights.push(data.positions[id] ?? new Map());
    original.set(id, next);
    return next;
  };
  if (!entry.bisect && mesh.positions.some((_, id) => distance(id) < -entry.mergeDistance))
    throw new Error("Mirror source crosses the selected plane side; enable bisect or choose a half-mesh/offset plane");
  mesh.faces.forEach((face, faceId) => {
    if (
      face.every((id) => Math.abs(distance(id)) <= entry.mergeDistance) &&
      face.some((id, i) => (graph.edges.get(edgeKey(id, face[(i + 1) % face.length] ?? -1))?.length ?? 0) === 1)
    )
      throw new Error("An open face lies on the mirror plane; move the plane or remove that face explicitly");
    const samples = data.corners[faceId] ?? [],
      loop: number[] = [],
      faceCorners: Weights[] = [];
    const intersects =
      face.some((id) => distance(id) > entry.mergeDistance) && face.some((id) => distance(id) < -entry.mergeDistance);
    if (entry.bisect && intersects && !isConvex(mesh, face))
      throw new Error("Bisecting a concave face is unsupported; subdivide it before mirroring");
    face.forEach((from, i) => {
      const to = face[(i + 1) % face.length];
      if (to === undefined) throw new Error("Invalid mirror face");
      const a = distance(from),
        b = distance(to),
        wa = samples[i],
        wb = samples[(i + 1) % face.length];
      if (!wa || !wb) throw new Error("Missing mirror corner attributes");
      if (a >= -entry.mergeDistance) {
        loop.push(addOriginal(from));
        faceCorners.push(wa);
      }
      if (
        entry.bisect &&
        ((a > entry.mergeDistance && b < -entry.mergeDistance) || (a < -entry.mergeDistance && b > entry.mergeDistance))
      ) {
        const t = a / (a - b),
          key = edgeKey(from, to);
        let id = crossing.get(key);
        if (id === undefined) {
          id = positions.length;
          crossing.set(key, id);
          positions.push(point(mesh, from).clone().lerp(point(mesh, to), t).setComponent(axis, entry.origin));
          weights.push(
            blend([
              [data.positions[from] ?? new Map(), 1 - t],
              [data.positions[to] ?? new Map(), t],
            ]),
          );
        }
        loop.push(id);
        faceCorners.push(
          blend([
            [wa, 1 - t],
            [wb, t],
          ]),
        );
      }
    });
    if (loop.length < 3 || loop.every((id) => positions[id]?.getComponent(axis) === entry.origin)) return;
    faces.push(loop);
    corners.push(faceCorners);
    materials.push(data.materials[faceId] ?? 0);
    sources.push(startsAtBase ? faceId : (mesh.faceSources?.[faceId] ?? -1));
  });
  if (!faces.length) throw new Error("Mirror has no off-plane faces on the retained side");
  const mirrored = positions.map((p, id) => {
    if (p.getComponent(axis) === entry.origin) return id;
    const next = positions.length;
    positions.push(p.clone().setComponent(axis, 2 * entry.origin - p.getComponent(axis)));
    weights.push(weights[id] ?? new Map());
    return next;
  });
  const count = faces.length;
  for (let id = 0; id < count; id++) {
    const face = faces[id];
    if (!face) throw new Error("Missing mirror face");
    faces.push(
      face
        .slice()
        .reverse()
        .map((vertex) => {
          const next = mirrored[vertex];
          if (next === undefined) throw new Error("Missing reflected vertex");
          return next;
        }),
    );
    corners.push((corners[id] ?? []).slice().reverse());
    materials.push(materials[id] ?? 0);
    sources.push(sources[id] ?? -1);
  }
  // Do not require a closed result when bisecting an open source sheet, but validate manifold fans and faces.
  const used = new Set(faces.flat()),
    remap = new Map<number, number>(),
    compact: Vector3[] = [],
    compactWeights: Weights[] = [];
  positions.forEach((p, id) => {
    if (used.has(id)) {
      remap.set(id, compact.length);
      compact.push(p);
      compactWeights.push(weights[id] ?? new Map());
    }
  });
  const compactFaces = faces.map((face) =>
    face.map((id) => {
      const next = remap.get(id);
      if (next === undefined) throw new Error("Missing mirror remapping");
      return next;
    }),
  );
  const result = {
    positions: compact,
    faces: compactFaces,
    channels: { positions: compactWeights, corners, materials },
    faceSources: sources,
  };
  topologyResult(mesh, result, []);
  return result;
}
