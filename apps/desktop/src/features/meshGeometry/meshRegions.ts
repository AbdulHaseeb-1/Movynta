import { Vector3 } from "three";
import type { PolygonMesh, Topology } from "./meshTopology";

/** For each face, the lowest face number of the connected shell it belongs to (faces joined by shared edges). */
export function shellRoots(mesh: PolygonMesh): Int32Array {
  const parent = Int32Array.from({ length: mesh.faces.length }, (_, face) => face);
  const find = (face: number): number => {
    let root = face;
    while ((parent[root] ?? root) !== root) root = parent[root] ?? root;
    for (let walk = face; walk !== root;) {
      const next = parent[walk] ?? root;
      parent[walk] = root;
      walk = next;
    }
    return root;
  };
  const count = mesh.positions.length,
    owner = new Map<number, number>();
  mesh.faces.forEach((face, index) =>
    face.forEach((from, corner) => {
      const to = face[(corner + 1) % face.length] ?? from,
        key = from < to ? from * count + to : to * count + from;
      const other = owner.get(key);
      if (other === undefined) owner.set(key, index);
      else {
        const a = find(index),
          b = find(other);
        if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
      }
    }),
  );
  return parent.map((_, face) => find(face));
}

/** One closed loop of edges on a mesh's boundary. */
export interface BoundaryLoop {
  /** Canonical edge IDs in walking order. */ edges: string[];
  vertices: number[];
}
/** All the boundary loops of a mesh. */
export interface BoundaryLoops {
  loops: BoundaryLoop[];
  /** Boundary edges that are not part of a simple closed loop: a chain that does not close, or a vertex where openings touch. */
  irregular: number;
}

/**
 * The openings of a mesh: every closed chain of boundary edges (edges with a face on one side only), walked the way
 * the faces wind them. A vertex where two openings touch makes the walk ambiguous, so the chains through it are not
 * reported as loops and their edges are counted in `irregular`.
 */
export function boundaryLoops(graph: Topology): BoundaryLoops {
  const next = new Map<number, { to: number; key: string }>();
  const touching = new Set<number>();
  let boundary = 0;
  for (const [key, incident] of graph.edges) {
    const half = incident[0];
    if (incident.length !== 1 || !half) continue;
    boundary += 1;
    if (next.has(half.from)) touching.add(half.from);
    else next.set(half.from, { to: half.to, key });
  }
  const loops: BoundaryLoop[] = [],
    visited = new Set<number>();
  let emitted = 0;
  for (const start of next.keys()) {
    if (visited.has(start)) continue;
    const edges: string[] = [],
      vertices: number[] = [];
    let at = start,
      closed = false;
    for (;;) {
      if (visited.has(at) && at !== start) break;
      if (touching.has(at)) break;
      const step = next.get(at);
      if (!step) break;
      visited.add(at);
      vertices.push(at);
      edges.push(step.key);
      at = step.to;
      if (at === start) {
        closed = true;
        break;
      }
    }
    if (closed && edges.length >= 3) {
      loops.push({ edges, vertices });
      emitted += edges.length;
    }
  }
  return { loops, irregular: boundary - emitted };
}

/** A summary of one connected shell of a mesh. */
export interface ShellSummary {
  faceCount: number;
  /** The lowest face number in the shell: naming it names the whole shell (for example to flip it). */
  firstFace: number;
  /** No boundary edge: the shell encloses a volume. */
  closed: boolean;
  min: [number, number, number];
  max: [number, number, number];
  center: [number, number, number];
}

/** The connected parts of a mesh, by lowest face number, with their size and extent in mesh-local space. */
export function shellSummaries(mesh: PolygonMesh, graph: Topology): ShellSummary[] {
  const roots = shellRoots(mesh);
  const summaries = new Map<number, { faceCount: number; open: boolean; min: Vector3; max: Vector3 }>();
  mesh.faces.forEach((face, index) => {
    const root = roots[index] ?? index;
    let entry = summaries.get(root);
    if (!entry) {
      entry = {
        faceCount: 0,
        open: false,
        min: new Vector3(Infinity, Infinity, Infinity),
        max: new Vector3(-Infinity, -Infinity, -Infinity),
      };
      summaries.set(root, entry);
    }
    entry.faceCount += 1;
    for (const vertex of face) {
      const p = mesh.positions[vertex];
      if (p) {
        entry.min.min(p);
        entry.max.max(p);
      }
    }
  });
  for (const incident of graph.edges.values()) {
    const half = incident[0];
    if (incident.length === 1 && half) {
      const entry = summaries.get(roots[half.face] ?? half.face);
      if (entry) entry.open = true;
    }
  }
  return [...summaries]
    .sort((a, b) => a[0] - b[0])
    .map(([firstFace, entry]) => ({
      faceCount: entry.faceCount,
      firstFace,
      closed: !entry.open,
      min: entry.min.toArray(),
      max: entry.max.toArray(),
      center: entry.min.clone().add(entry.max).multiplyScalar(0.5).toArray(),
    }));
}
