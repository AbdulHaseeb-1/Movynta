import type { BufferGeometry, Vector3 } from "three";
import { channels, continuityChannels, faceNormal, point, topology, type PolygonMesh } from "./meshTopology";
import { evaluate, type Weights } from "./meshWeights";
import { requireIds, topologyResult } from "./meshTopologyEdit";
import { triangulate } from "./meshOutput";

/** Dissolve coplanar internal edges while refusing material boundaries, seams and regions with holes. */
export function dissolveEdges(mesh: PolygonMesh, ids: readonly string[], source: BufferGeometry) {
  requireIds(ids);
  const graph = topology(mesh), data = channels(mesh), selected = new Set(ids);
  const parent = mesh.faces.map((_, i) => i);
  const root = (id: number): number => { let current = id; while (parent[current] !== current) { const next = parent[current]; if (next === undefined) throw new Error("Invalid face group"); current = next; } return current; };
  const attrs = [...continuityChannels(source), ...(source.morphAttributes.position ?? []),
    source.getAttribute("skinIndex"), source.getAttribute("skinWeight")].filter((attr) => attr !== undefined);
  for (const id of ids) {
    const [a, b] = graph.edges.get(id) ?? [];
    if (!a || !b || graph.edges.get(id)?.length !== 2) throw new Error(`Dissolve requires manifold internal edges: ${id}`);
    if (data.materials[a.face] !== data.materials[b.face]) throw new Error("Dissolve cannot cross a material boundary");
    const fa = mesh.faces[a.face] ?? [], fb = mesh.faces[b.face] ?? [];
    const normal = faceNormal(mesh, fa), other = faceNormal(mesh, fb);
    const origin = point(mesh, fa[0]);
    const size = Math.max(...fa.concat(fb).map((v) => point(mesh, v).distanceTo(origin)), 1e-10);
    if (normal.dot(other) < 1 - 1e-8 || fb.some((v) => Math.abs(point(mesh, v).clone().sub(origin).dot(normal)) > size * 1e-6)) throw new Error("Dissolve supports coplanar faces; this edge changes the surface shape");
    for (const vertex of [a.from, a.to]) {
      const left = data.corners[a.face]?.[fa.indexOf(vertex)], right = data.corners[b.face]?.[fb.indexOf(vertex)];
      if (!left || !right) throw new Error("Missing corner attributes");
      if (attrs.some((attr) => Array.from({ length: attr.itemSize }, (_, c) => Math.abs(evaluate(attr, left, c) - evaluate(attr, right, c))).some((difference) => difference > 1e-6))) throw new Error("Dissolve cannot cross an attribute or UV seam");
    }
    parent[root(b.face)] = root(a.face);
  }
  const groups = new Map<number, number[]>();
  mesh.faces.forEach((_, face) => { const key = root(face), group = groups.get(key) ?? []; group.push(face); groups.set(key, group); });
  const faces: number[][] = [], corners: Weights[][] = [], materials: number[] = [], selection: string[] = [];
  for (const group of groups.values()) {
    if (group.length === 1) {
      const face = group[0]; if (face === undefined) continue;
      faces.push(mesh.faces[face] ?? []); corners.push(data.corners[face] ?? []); materials.push(data.materials[face] ?? 0); continue;
    }
    const members = new Set(group);
    // Removing internal samples is exact only for attributes affine across the entire planar region.
    const firstFace = group[0] ?? -1, first = mesh.faces[firstFace] ?? [];
    const triangle = triangulate(mesh, first)[0];
    if (!triangle) throw new Error("Dissolve face has no stable triangulation");
    const [ai, bi, ci] = triangle;
    if (ai === undefined || bi === undefined || ci === undefined) throw new Error("Invalid dissolve triangle");
    const origin = point(mesh, first[ai]), u = point(mesh, first[bi]).clone().sub(origin), v = point(mesh, first[ci]).clone().sub(origin);
    const wa = data.corners[firstFace]?.[ai], wb = data.corners[firstFace]?.[bi], wc = data.corners[firstFace]?.[ci];
    if (!wa || !wb || !wc) throw new Error("Missing dissolve attributes");
    const uu = u.dot(u), uv = u.dot(v), vv = v.dot(v), determinant = uu * vv - uv * uv;
    if (!(determinant > 0)) throw new Error("Dissolve region is degenerate");
    const regionNormal = u.clone().cross(v).normalize();
    let extent = 1e-10;
    for (const faceId of group) for (const vertex of mesh.faces[faceId] ?? []) extent = Math.max(extent, point(mesh, vertex).distanceTo(origin));
    for (const faceId of group) (mesh.faces[faceId] ?? []).forEach((vertex, corner) => {
      const delta = point(mesh, vertex).clone().sub(origin), du = delta.dot(u), dv = delta.dot(v);
      if (Math.abs(delta.dot(regionNormal)) > extent * 1e-6) throw new Error("The complete dissolve region must be coplanar");
      const beta = (du * vv - dv * uv) / determinant, gamma = (dv * uu - du * uv) / determinant;
      const sample = data.corners[faceId]?.[corner]; if (!sample) throw new Error("Missing dissolve attributes");
      for (const attr of attrs) for (let c = 0; c < attr.itemSize; c += 1) {
        const expected = (1 - beta - gamma) * evaluate(attr, wa, c) + beta * evaluate(attr, wb, c) + gamma * evaluate(attr, wc, c);
        const actual = evaluate(attr, sample, c);
        if (Math.abs(expected - actual) > Math.max(1, Math.abs(expected), Math.abs(actual)) * 1e-6) throw new Error("Dissolve would remove non-affine UV, color or deformation detail");
      }
    });
    const boundary = new Map<number, { to: number; sample: Weights }>();
    for (const faceId of group) {
      const face = mesh.faces[faceId] ?? [];
      face.forEach((from, corner) => {
        const to = face[(corner + 1) % face.length]; if (to === undefined) throw new Error("Invalid face");
        const key = from < to ? `${from}_${to}` : `${to}_${from}`;
        if (selected.has(key)) return;
        if ((graph.edges.get(key) ?? []).filter((edge) => members.has(edge.face)).length === 2) throw new Error("Select all internal edges of the region to dissolve");
        const sample = data.corners[faceId]?.[corner];
        if (!sample || boundary.has(from)) throw new Error("Dissolve region has a pinched or branching boundary");
        boundary.set(from, { to, sample });
      });
    }
    const start = boundary.keys().next().value;
    if (start === undefined) throw new Error("Dissolve region has no boundary");
    const loop: number[] = [], samples: Weights[] = [];
    let current = start;
    while (boundary.has(current)) {
      const edge = boundary.get(current); if (!edge) break;
      boundary.delete(current); loop.push(current); samples.push(edge.sample); current = edge.to;
    }
    if (current !== start || boundary.size) throw new Error("Dissolve region must have one boundary without holes");
    selection.push(String(faces.length)); faces.push(loop); corners.push(samples); materials.push(data.materials[group[0] ?? -1] ?? 0);
  }
  // Interior vertices removed by a region dissolve must not remain as unused control points.
  const used = new Set(faces.flat()), remap = new Map<number, number>();
  const positions: Vector3[] = [], weights: Weights[] = [];
  mesh.positions.forEach((position, id) => { if (used.has(id)) { remap.set(id, positions.length); positions.push(position); weights.push(data.positions[id] ?? new Map()); } });
  const mapped = faces.map((face) => face.map((id) => { const next = remap.get(id); if (next === undefined) throw new Error("Invalid dissolve mapping"); return next; }));
  return topologyResult(mesh, { positions, faces: mapped, channels: { positions: weights, corners, materials } }, selection);
}
