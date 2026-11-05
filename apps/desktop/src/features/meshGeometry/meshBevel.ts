import { Vector2, Vector3 } from "three";
import { MAX_MESH_OUTPUT_TRIANGLES, MAX_SELECTED_BEVEL_SEGMENTS } from "@movynta/editor-protocol";
import { assertManifold, channels, edgeKey, faceNormal, point, topology, type PolygonMesh, type SurfaceChannels, type Topology } from "./meshTopology";
import { blend, mean, type Weights } from "./meshWeights";
import type { BevelProfile } from "./meshModifiers";

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

interface BevelInput { graph: Topology; data: SurfaceChannels; normals: Vector3[]; positions: Weights[]; corners: Weights[][] }

function prepareInput(mesh: PolygonMesh): BevelInput {
  const graph = topology(mesh); assertManifold(mesh, graph);
  const data = channels(mesh);
  return { graph, data, normals: mesh.faces.map((face) => faceNormal(mesh, face)),
    positions: data.positions.map((weights) => blend([[weights, 1]])),
    corners: data.corners.map((face) => face.map((weights) => blend([[weights, 1]]))) };
}

/** Reuse immutable input topology and attribute channels across previews of the same cage. */
export function prepareBevelPreview(mesh: PolygonMesh, selectedEdges: readonly string[]): (width: number, segments: number) => PolygonMesh {
  const input = prepareInput(mesh);
  const ids = [...selectedEdges];
  return (width, segments) => bevelSurfaceWithInput(mesh, width, segments, "circular", 0, ids, input, true);
}

/** Face offsets, edge strips and local vertex patches. Open boundaries remain open. */
export function bevelSurface(mesh: PolygonMesh, width: number, segments: number, profile: BevelProfile = "round", angle = 0, selectedEdges?: readonly string[], trimEndFaces = false): PolygonMesh {
  return bevelSurfaceWithInput(mesh, width, segments, profile, angle, selectedEdges, prepareInput(mesh), trimEndFaces);
}

function bevelSurfaceWithInput(mesh: PolygonMesh, width: number, segments: number, profile: BevelProfile, angle: number, selectedEdges: readonly string[] | undefined, input: BevelInput, trimEndFaces: boolean): PolygonMesh {
  const maxSegments = selectedEdges === undefined ? 8 : MAX_SELECTED_BEVEL_SEGMENTS;
  if (!Number.isFinite(width) || width <= 0 || !Number.isInteger(segments) || segments < 1 || segments > maxSegments) throw new Error(`Bevel needs positive width and 1–${maxSegments} segments`);
  if (profile !== "chamfer" && profile !== "round" && profile !== "circular") throw new Error("Unsupported bevel profile");
  if (!Number.isFinite(angle) || angle < 0 || angle > 180) throw new Error("Bevel angle must be between 0 and 180 degrees");
  const { graph, data, normals } = input;
  const selected = selectedEdges === undefined ? undefined : new Set(selectedEdges);
  if (selected && (selected.size === 0 || selected.size !== selectedEdges?.length)) throw new Error("Select distinct edges to bevel");
  if (selected) for (const id of selected) {
    const incident = graph.edges.get(id);
    if (!incident) throw new Error(`Bevel edge ${id} does not exist`);
    if (incident.length !== 2) throw new Error("Bevel does not support boundary edges");
  }
  const limit = angle * Math.PI / 180;
  const active = new Set<string>();
  for (const [key, incident] of graph.edges) {
    if (selected && !selected.has(key)) continue;
    const [a, b] = incident; if (!a || !b) continue;
    const na = normals[a.face]; const nb = normals[b.face];
    if (!na || !nb) continue;
    const turn = Math.acos(Math.min(1, Math.max(-1, na.dot(nb))));
    // A coplanar seam or tessellation diagonal has no corner to round.
    if (turn > 1e-6 && turn + 1e-8 >= limit) active.add(key);
  }
  if (selected && active.size !== selected.size) throw new Error("Bevel does not support coplanar edges");
  if (active.size === 0) return mesh;
  const activeDegree = new Map<number, number>();
  if (trimEndFaces) for (const key of active) {
    const edge = graph.edges.get(key)?.[0];
    if (edge) for (const vertex of [edge.from, edge.to]) activeDegree.set(vertex, (activeDegree.get(vertex) ?? 0) + 1);
  }
  if (active.size * segments * 4 + mesh.faces.reduce((sum, face) => sum + face.length, 0) * 2 > MAX_MESH_OUTPUT_TRIANGLES) throw new Error("Bevel would exceed the geometry limit");
  const positions: Vector3[] = []; const positionWeights: Weights[] = []; const origins: number[] = [];
  const faces: number[][] = []; const corners: Weights[][] = []; const materials: number[] = [];
  const faceSources: number[] | undefined = mesh.faceSources ? [] : undefined;
  const lookup = new Map<string, number>(); const sampleLookup = new Map<string, Weights>();
  const surfaceSamples = new Map<number, Weights>();
  const addPoint = (p: Vector3, weights: Weights, origin: number): number => {
    positionWeights.push(weights); origins.push(origin); return positions.push(p) - 1;
  };
  const addFace = (face: number[], samples: Weights[], material: number, source = -1): void => {
    faces.push(face); corners.push(samples); materials.push(material);
    faceSources?.push(source);
  };
  mesh.faces.forEach((face, faceId) => {
    const normal = normals[faceId]; if (!normal || normal.lengthSq() === 0) throw new Error("Bevel requires nondegenerate faces");
    let projection: { project: (p: Vector3) => Vector2; polygon: Vector2[] } | undefined;
    const inset: number[] = []; const samples: Weights[] = [];
    face.forEach((vertex, i) => {
      const previous = face[(i + face.length - 1) % face.length]; const next = face[(i + 1) % face.length];
      if (previous === undefined || next === undefined) throw new Error("Invalid face");
      const p = point(mesh, vertex);
      const wa = active.has(edgeKey(previous, vertex)) ? width : 0; const wb = active.has(edgeKey(vertex, next)) ? width : 0;
      if (wa === 0 && wb === 0) {
        const weights = input.positions[vertex]; const sample = input.corners[faceId]?.[i];
        if (!weights || !sample) throw new Error("Missing mesh attributes");
        const id = addPoint(p.clone(), weights, vertex); inset.push(id); samples.push(sample);
        surfaceSamples.set(id, sample); lookup.set(`${faceId}_${vertex}`, id); sampleLookup.set(`${faceId}_${vertex}`, sample);
        return;
      }
      const incoming = p.clone().sub(point(mesh, previous)).normalize();
      const outgoing = point(mesh, next).clone().sub(p).normalize();
      const a = normal.clone().cross(incoming); const b = normal.clone().cross(outgoing); const dot = a.dot(b);
      const determinant = 1 - dot * dot;
      const moved = p.clone();
      if (determinant < 1e-10) {
        if (Math.abs(wa - wb) > 1e-8) throw new Error("Bevel cannot stop partway along a straight edge; select the full straight run");
        moved.add(a.multiplyScalar(wa));
      } else moved.add(a.multiplyScalar((wa - dot * wb) / determinant)).add(b.multiplyScalar((wb - dot * wa) / determinant));
      if (!projection) {
        const axis = point(mesh, face[1]).clone().sub(point(mesh, face[0])).normalize();
        const second = normal.clone().cross(axis).normalize(); const origin = point(mesh, face[0]);
        const project = (value: Vector3): Vector2 => { const v = value.clone().sub(origin); return new Vector2(v.dot(axis), v.dot(second)); };
        projection = { project, polygon: face.map((id) => project(point(mesh, id))) };
      }
      if (!inside(projection.project(moved), projection.polygon)) throw new Error("Bevel width overlaps a face; reduce width");
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
    addFace(inset, samples, data.materials[faceId] ?? 0, mesh.faceSources?.[faceId]);
  });
  for (const [key, incident] of graph.edges) {
    if (!active.has(key)) continue;
    const [a, b] = incident; if (!a || !b) continue;
    const na = normals[a.face]; const nb = normals[b.face];
    if (!na || !nb) throw new Error("Missing bevel normals");
    const middleWeight = profile === "circular" ? Math.sqrt(Math.max(0, (1 + na.dot(nb)) / 2)) : 1;
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
        const leftTerm = profile === "chamfer" ? 1 - t : (1 - t) ** 2;
        const centerTerm = profile === "chamfer" ? 0 : 2 * t * (1 - t) * middleWeight;
        const rightTerm = profile === "chamfer" ? t : t * t;
        const total = profile === "circular" ? leftTerm + centerTerm + rightTerm : 1;
        const left = leftTerm / total;
        const center = centerTerm / total;
        const right = rightTerm / total;
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
  // Selective bevel shortens some inactive seams on only one side. Split the longer
  // face edge at the overlap so it can share the seam without adding a zero-area strip.
  for (const [key, [a, b]] of graph.edges) {
    if (active.has(key) || !a || !b) continue;
    const endpoint = (face: number, vertex: number) => {
      const id = lookup.get(`${face}_${vertex}`);
      return id === undefined ? undefined : remap.get(id);
    };
    const a0 = endpoint(a.face, a.from); const a1 = endpoint(a.face, a.to);
    const b0 = endpoint(b.face, a.from); const b1 = endpoint(b.face, a.to);
    if (a0 === undefined || a1 === undefined || b0 === undefined || b1 === undefined) throw new Error("Missing bevel seam");
    if (a0 === b0 && a1 === b1) continue;
    const origin = point(mesh, a.from);
    const direction = point(mesh, a.to).clone().sub(origin).normalize();
    const along = (id: number) => (positions[id]?.clone().sub(origin).dot(direction) ?? 0);
    const start = along(a0) >= along(b0) ? a0 : b0;
    const end = along(a1) <= along(b1) ? a1 : b1;
    if (along(start) >= along(end)) throw new Error("Bevel width overlaps an inactive seam; reduce width");
    const split = (face: number, from: number, to: number, first: number, last: number) => {
      const ids = mapped[face]; const samples = corners[face];
      if (!ids || !samples) throw new Error("Missing bevel face");
      const index = ids.indexOf(from);
      const left = samples[index]; const right = samples[(index + 1) % ids.length];
      if (!left || !right || ids[(index + 1) % ids.length] !== to) throw new Error("Missing bevel seam corner");
      const additions = [first, last].filter((id) => id !== from && id !== to);
      const span = along(to) - along(from);
      const addedSamples = additions.map((id) => {
        const t = (along(id) - along(from)) / span;
        return blend([[left, 1 - t], [right, t]]);
      });
      ids.splice(index + 1, 0, ...additions);
      samples.splice(index + 1, 0, ...addedSamples);
    };
    split(a.face, a0, a1, start, end);
    split(b.face, b1, b0, end, start);
  }
  const result: PolygonMesh = { positions, faces: mapped, channels: { positions: positionWeights, corners, materials } };
  const boundaries = new Map<number, number>();
  const boundaryMaterials = new Map<number, number>();
  for (const incident of topology(result).edges.values()) if (incident.length === 1) { const edge = incident[0]; if (edge) { boundaries.set(edge.to, edge.from); boundaryMaterials.set(edge.to, materials[edge.face] ?? 0); } }
  while (boundaries.size > 0) {
    const start = boundaries.keys().next().value; if (start === undefined) break;
    const loop: number[] = []; let current: number | undefined = start;
    while (current !== undefined && boundaries.has(current)) { loop.push(current); const next: number | undefined = boundaries.get(current); boundaries.delete(current); current = next; }
    if (current === start && loop.length >= 3 && loop.every((id) => origins[id] === origins[start])) {
      // An edge ending on a planar face used to add a cap over the existing
      // face. Replace that face's sharp corner with the profile instead of overlapping it.
      let trimmed = false;
      if (trimEndFaces && activeDegree.get(origins[start] ?? -1) === 1) {
        const original = point(mesh, origins[start]);
        for (let faceId = 0; faceId < mesh.faces.length && !trimmed; faceId += 1) {
          const face = mapped[faceId]; const samples = corners[faceId]; const normal = normals[faceId];
          if (!face || !samples || !normal) continue;
          const corner = face.findIndex((id) => positions[id]?.distanceToSquared(original) === 0 && loop.includes(id));
          if (corner < 0 || loop.some((id) => Math.abs((positions[id]?.clone().sub(original).dot(normal) ?? Infinity)) > 1e-7)) continue;
          const before = face[(corner + face.length - 1) % face.length]; const after = face[(corner + 1) % face.length];
          const vertex = face[corner];
          if (before === undefined || after === undefined || vertex === undefined) continue;
          const vertexAt = loop.indexOf(vertex); const beforeAt = loop.indexOf(before); const afterAt = loop.indexOf(after);
          if (vertexAt < 0 || beforeAt < 0 || afterAt < 0 || ![1, loop.length - 1].includes((beforeAt - vertexAt + loop.length) % loop.length) || ![1, loop.length - 1].includes((afterAt - vertexAt + loop.length) % loop.length)) continue;
          const direction = (beforeAt + 1) % loop.length === vertexAt ? -1 : 1;
          const arc: number[] = []; let at = beforeAt;
          while (at !== afterAt && arc.length <= loop.length) { arc.push(loop[at] ?? -1); at = (at + direction + loop.length) % loop.length; }
          arc.push(after);
          if (arc.includes(vertex) || arc.some((id) => id < 0)) continue;
          const rotatedFace = [...face.slice((corner + face.length - 1) % face.length), ...face.slice(0, (corner + face.length - 1) % face.length)];
          const rotatedSamples = [...samples.slice((corner + face.length - 1) % face.length), ...samples.slice(0, (corner + face.length - 1) % face.length)];
          const sa = rotatedSamples[0]; const sv = rotatedSamples[1]; const sb = rotatedSamples[2];
          const pa = positions[before]; const pb = positions[after];
          if (!sa || !sv || !sb || !pa || !pb) continue;
          const arcSamples = arc.slice(1, -1).map((id) => {
            const [u, v] = coefficients(original, pa, pb, point(result, id));
            return blend([[sv, 1 - u - v], [sa, u], [sb, v]]);
          });
          mapped[faceId] = [before, ...arc.slice(1, -1), after, ...rotatedFace.slice(3)];
          corners[faceId] = [sa, ...arcSamples, sb, ...rotatedSamples.slice(3)];
          trimmed = true;
        }
      }
      if (trimmed) continue;
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
  return { positions: compact, faces: compactFaces, channels: { positions: weights, corners, materials }, ...(faceSources ? { faceSources } : {}) };
}
