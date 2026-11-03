import { Vector2, Vector3 } from "three";
import { MAX_MESH_OUTPUT_TRIANGLES } from "@movynta/editor-protocol";
import { assertManifold, channels, edgeKey, faceNormal, point, topology, type PolygonMesh } from "./meshTopology";
import { blend, mean, type Weights } from "./meshWeights";

function coefficients(p: Vector3, a: Vector3, b: Vector3, target: Vector3): [number, number] {
  const u = a.clone().sub(p); const v = b.clone().sub(p); const delta = target.clone().sub(p);
  const uu = u.dot(u); const vv = v.dot(v); const uv = u.dot(v); const determinant = uu * vv - uv * uv;
  if (determinant < 1e-20) throw new Error("Bevel encountered a degenerate face");
  return [(delta.dot(u) * vv - delta.dot(v) * uv) / determinant, (delta.dot(v) * uu - delta.dot(u) * uv) / determinant];
}
function inside(p: Vector2, polygon: readonly Vector2[]): boolean {
  let result = false;
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i]; const b = polygon[(i + 1) % polygon.length]; if (!a || !b) continue;
    const edge = b.clone().sub(a); const delta = p.clone().sub(a);
    if (Math.abs(edge.cross(delta)) < 1e-8 && delta.dot(edge) >= -1e-8 && delta.dot(edge) <= edge.lengthSq() + 1e-8) return true;
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) result = !result;
  }
  return result;
}

/** Face offsets, edge strips and local vertex patches. Open boundaries remain open. */
export function bevelSurface(mesh: PolygonMesh, width: number, segments: number, profile: "chamfer" | "round" = "round", angle = 0): PolygonMesh {
  if (!Number.isFinite(width) || width <= 0 || !Number.isInteger(segments) || segments < 1 || segments > 8) throw new Error("Bevel needs positive width and 1–8 segments");
  if (profile !== "chamfer" && profile !== "round") throw new Error("Bevel profile must be chamfer or round");
  if (!Number.isFinite(angle) || angle < 0 || angle > 180) throw new Error("Bevel angle must be between 0 and 180 degrees");
  const graph = topology(mesh); assertManifold(mesh, graph);
  const data = channels(mesh); const normals = mesh.faces.map((face) => faceNormal(mesh, face));
  const limit = angle * Math.PI / 180;
  const active = new Set<string>();
  for (const [key, incident] of graph.edges) {
    const [a, b] = incident; if (!a || !b) continue;
    const na = normals[a.face]; const nb = normals[b.face];
    if (!na || !nb) continue;
    const turn = Math.acos(Math.min(1, Math.max(-1, na.dot(nb))));
    if (turn + 1e-8 >= limit) active.add(key);
  }
  if (active.size === 0) return mesh;
  if (active.size * segments * 4 + mesh.faces.reduce((sum, face) => sum + face.length, 0) * 2 > MAX_MESH_OUTPUT_TRIANGLES) throw new Error("Bevel would exceed the geometry limit");
  const positions: Vector3[] = []; const positionWeights: Weights[] = []; const origins: number[] = [];
  const faces: number[][] = []; const corners: Weights[][] = []; const materials: number[] = [];
  const lookup = new Map<string, number>(); const sampleLookup = new Map<string, Weights>();
  const surfaceSamples = new Map<number, Weights>();
  const addPoint = (p: Vector3, weights: Weights, origin: number): number => {
    positionWeights.push(weights); origins.push(origin); return positions.push(p) - 1;
  };
  const addFace = (face: number[], samples: Weights[], material: number): void => {
    faces.push(face); corners.push(samples); materials.push(material);
  };
  mesh.faces.forEach((face, faceId) => {
    const normal = normals[faceId]; if (!normal || normal.lengthSq() === 0) throw new Error("Bevel requires nondegenerate faces");
    const axis = point(mesh, face[1]).clone().sub(point(mesh, face[0])).normalize();
    const second = normal.clone().cross(axis).normalize(); const origin = point(mesh, face[0]);
    const project = (p: Vector3): Vector2 => { const v = p.clone().sub(origin); return new Vector2(v.dot(axis), v.dot(second)); };
    const polygon = face.map((id) => project(point(mesh, id)));
    const inset: number[] = []; const samples: Weights[] = [];
    face.forEach((vertex, i) => {
      const previous = face[(i + face.length - 1) % face.length]; const next = face[(i + 1) % face.length];
      if (previous === undefined || next === undefined) throw new Error("Invalid face");
      const p = point(mesh, vertex); const incoming = p.clone().sub(point(mesh, previous)).normalize();
      const outgoing = point(mesh, next).clone().sub(p).normalize();
      const a = normal.clone().cross(incoming); const b = normal.clone().cross(outgoing); const dot = a.dot(b);
      const wa = active.has(edgeKey(previous, vertex)) ? width : 0; const wb = active.has(edgeKey(vertex, next)) ? width : 0;
      const determinant = 1 - dot * dot;
      const moved = p.clone();
      if (determinant < 1e-10) {
        if (Math.abs(wa - wb) > 1e-8) throw new Error("Bevel encountered an unsupported collinear edge junction");
        moved.add(a.multiplyScalar(wa));
      } else moved.add(a.multiplyScalar((wa - dot * wb) / determinant)).add(b.multiplyScalar((wb - dot * wa) / determinant));
      if (!inside(project(moved), polygon)) throw new Error("Bevel width overlaps a face; reduce width");
      let other = (i + 2) % face.length; let area = 0;
      face.forEach((id, corner) => {
        const value = point(mesh, next).clone().sub(p).cross(point(mesh, id).clone().sub(p)).lengthSq();
        if (value > area) { area = value; other = corner; }
      });
      const [u, v] = coefficients(p, point(mesh, next), point(mesh, face[other]), moved);
      const vertexSample = data.positions[vertex]; const nextSample = data.positions[next]; const otherId = face[other];
      const otherSample = otherId === undefined ? undefined : data.positions[otherId];
      const c = data.corners[faceId]?.[i]; const cn = data.corners[faceId]?.[(i + 1) % face.length]; const co = data.corners[faceId]?.[other];
      if (!vertexSample || !nextSample || !otherSample || !c || !cn || !co) throw new Error("Missing mesh attributes");
      const weights = blend([[vertexSample, 1 - u - v], [nextSample, u], [otherSample, v]]);
      const sample = blend([[c, 1 - u - v], [cn, u], [co, v]]);
      const id = addPoint(moved, weights, vertex); inset.push(id); samples.push(sample);
      surfaceSamples.set(id, sample);
      lookup.set(`${faceId}_${vertex}`, id); sampleLookup.set(`${faceId}_${vertex}`, sample);
    });
    for (let i = 0; i < face.length; i += 1) {
      const a = positions[inset[i] ?? -1]; const b = positions[inset[(i + 1) % face.length] ?? -1];
      const direction = point(mesh, face[(i + 1) % face.length]).clone().sub(point(mesh, face[i]));
      if (!a || !b || b.clone().sub(a).dot(direction) <= 1e-10) throw new Error("Bevel width is too large for this mesh");
    }
    addFace(inset, samples, data.materials[faceId] ?? 0);
  });
  for (const [key, incident] of graph.edges) {
    if (!active.has(key)) continue;
    const [a, b] = incident; if (!a || !b) continue;
    const edgeDirection = point(mesh, a.to).clone().sub(point(mesh, a.from)); const edgeLength = edgeDirection.length(); edgeDirection.normalize();
    const endpoint = (vertex: number): number[] => {
      const start = lookup.get(`${a.face}_${vertex}`); const end = lookup.get(`${b.face}_${vertex}`);
      const ca = sampleLookup.get(`${a.face}_${vertex}`); const cb = sampleLookup.get(`${b.face}_${vertex}`);
      if (start === undefined || end === undefined || !ca || !cb) throw new Error("Missing bevel endpoint");
      const pa = positions[start]; const pb = positions[end]; const original = point(mesh, vertex);
      const sa = positionWeights[start]; const sb = positionWeights[end]; const sv = data.positions[vertex];
      const neighbor = vertex === a.from ? a.to : a.from; const sn = data.positions[neighbor];
      if (!pa || !pb || !sa || !sb || !sv || !sn) throw new Error("Invalid bevel profile");
      const offset = (pa.clone().sub(original).dot(edgeDirection) + pb.clone().sub(original).dot(edgeDirection)) / 2;
      const anchor = original.clone().addScaledVector(edgeDirection, offset);
      const tEdge = offset / edgeLength * (vertex === a.from ? 1 : -1);
      const anchorWeights = blend([[sv, 1 - tEdge], [sn, tEdge]]);
      const ids = [start];
      for (let i = 1; i < segments; i += 1) {
        const t = i / segments;
        const left = profile === "chamfer" ? 1 - t : (1 - t) ** 2;
        const center = profile === "chamfer" ? 0 : 2 * t * (1 - t);
        const right = profile === "chamfer" ? t : t * t;
        const p = pa.clone().multiplyScalar(left).addScaledVector(anchor, center).addScaledVector(pb, right);
        const id = addPoint(p, blend([[sa, left], [anchorWeights, center], [sb, right]]), vertex);
        // New strip UVs and other face-varying values interpolate the adjacent source corners.
        sampleLookup.set(`strip_${id}`, blend([[ca, 1 - t], [cb, t]])); ids.push(id);
        surfaceSamples.set(id, blend([[ca, 1 - t], [cb, t]]));
      }
      ids.push(end); return ids;
    };
    const from = endpoint(a.from); const to = endpoint(a.to);
    const sample = (id: number): Weights => sampleLookup.get(`strip_${id}`) ?? sampleLookup.get(`${lookup.get(`${a.face}_${origins[id]}`) === id ? a.face : b.face}_${origins[id]}`) ?? positionWeights[id] ?? new Map();
    for (let i = 0; i < segments; i += 1) {
      const quad = [to[i], from[i], from[i + 1], to[i + 1]].filter((id): id is number => id !== undefined);
      addFace(quad, quad.map(sample), data.materials[a.face] ?? 0);
    }
  }
  // Weld zero-offset boundary corners while keeping separate per-face attribute stencils.
  const unique = new Map<string, number>(); const remap = new Map<number, number>();
  positions.forEach((p, id) => { const key = `${origins[id]}:${p.x.toPrecision(12)},${p.y.toPrecision(12)},${p.z.toPrecision(12)}`; const known = unique.get(key); if (known === undefined) unique.set(key, id); remap.set(id, known ?? id); });
  const mapped = faces.map((face) => face.map((id) => remap.get(id) ?? id));
  const result: PolygonMesh = { positions, faces: mapped, channels: { positions: positionWeights, corners, materials } };
  const boundaries = new Map<number, number>();
  const boundaryMaterials = new Map<number, number>();
  for (const incident of topology(result).edges.values()) if (incident.length === 1) { const edge = incident[0]; if (edge) { boundaries.set(edge.to, edge.from); boundaryMaterials.set(edge.to, materials[edge.face] ?? 0); } }
  while (boundaries.size > 0) {
    const start = boundaries.keys().next().value; if (start === undefined) break;
    const loop: number[] = []; let current: number | undefined = start;
    while (current !== undefined && boundaries.has(current)) { loop.push(current); const next: number | undefined = boundaries.get(current); boundaries.delete(current); current = next; }
    if (current === start && loop.length >= 3 && loop.every((id) => origins[id] === origins[start])) {
      const samples = loop.map((id) => surfaceSamples.get(id) ?? positionWeights[id] ?? new Map());
      const material = boundaryMaterials.get(start) ?? 0;
      if (loop.length === 3) { addFace(loop, samples, material); result.faces.push(loop); }
      else {
        const center = new Vector3(); for (const id of loop) center.add(point(result, id)); center.multiplyScalar(1 / loop.length);
        const weights = mean(loop.map((id) => positionWeights[id] ?? new Map())); const id = addPoint(center, weights, origins[start] ?? 0);
        const sample = mean(samples);
        for (let i = 0; i < loop.length; i += 1) {
          const a = loop[i]; const b = loop[(i + 1) % loop.length]; if (a === undefined || b === undefined) continue;
          const triangle = [a, b, id]; addFace(triangle, [surfaceSamples.get(a) ?? positionWeights[a] ?? weights, surfaceSamples.get(b) ?? positionWeights[b] ?? weights, sample], material); result.faces.push(triangle);
        }
      }
    }
  }
  assertManifold(result, topology(result), [...graph.edges.values()].every((edges) => edges.length === 2));
  const used = new Map<number, number>(); const compact: Vector3[] = []; const weights: Weights[] = [];
  const compactFaces = result.faces.map((face) => face.map((id) => {
    let next = used.get(id);
    if (next === undefined) { next = compact.length; compact.push(point(result, id)); weights.push(positionWeights[id] ?? new Map()); used.set(id, next); }
    return next;
  }));
  return { positions: compact, faces: compactFaces, channels: { positions: weights, corners, materials } };
}
