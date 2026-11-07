import { describe, expect, it } from "vitest";
import { BoxGeometry, CylinderGeometry, PlaneGeometry, SphereGeometry, TorusGeometry, Vector3, type BufferGeometry } from "three";
import { bisectMesh } from "./meshBisect";
import { correctNormals } from "./meshCorrectNormals";
import { createPolygonMesh } from "./createPolygonMesh";
import { deleteComponents } from "./meshDelete";
import { dissolveEdges } from "./meshDissolve";
import { fillHole } from "./meshFillHole";
import { flipNormals } from "./meshFlip";
import { insetFaces } from "./meshInset";
import { knifeChord, type KnifePoint } from "./meshKnifeChord";
import { loopCut } from "./meshLoopCut";
import { checkManifold } from "./meshManifold";
import { mergeVertices } from "./meshMerge";
import { subdivideFaces } from "./meshSubdivideFaces";
import { measureSurface } from "./meshTestSupport";
import { readTopology, topology, type PolygonMesh } from "./meshTopology";
import { triangulateFaces } from "./meshTriangulateFaces";

/*
 * Property tests: random meshes and random operations, checked against what must always hold. They found the
 * zero-area sliver and the polygon-touching-itself failures that the plane cut once had (see meshBisect.test.ts).
 * The generator is seeded, so a failure names the sequence that reproduces it.
 */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
}
const pick = <T,>(items: readonly T[], next: () => number): T | undefined => items[Math.floor(next() * items.length)];
type Problems = Map<string, string>;
const record = (problems: Problems, key: string, example: string) => { if (!problems.has(key)) problems.set(key, example); };

/** What every mesh the editor keeps must satisfy: aligned channels, valid indices, finite positions. */
function channelProblem(mesh: PolygonMesh): string | undefined {
  const data = mesh.channels;
  if (data) {
    if (data.positions.length !== mesh.positions.length) return "position weights do not match the vertices";
    if (data.corners.length !== mesh.faces.length || data.materials.length !== mesh.faces.length) return "corner or material lists do not match the faces";
    if (mesh.faces.some((face, index) => data.corners[index]?.length !== face.length)) return "a face has the wrong number of corner samples";
  }
  if (mesh.faces.some((face) => face.some((vertex) => !(vertex >= 0 && vertex < mesh.positions.length)))) return "a face points at a missing vertex";
  if (mesh.positions.some((p) => ![p.x, p.y, p.z].every(Number.isFinite))) return "a vertex is not finite";
  return undefined;
}
const internalError = (error: unknown): boolean => error instanceof TypeError || error instanceof RangeError;
const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const PRIMITIVES: (() => BufferGeometry)[] = [
  () => new BoxGeometry(1, 1, 1), () => new BoxGeometry(1, 2, 1, 2, 3, 2), () => new SphereGeometry(1, 8, 6),
  () => new SphereGeometry(1, 12, 8), () => new CylinderGeometry(1, 1, 2, 8, 2), () => new CylinderGeometry(0.5, 1, 2, 6, 1),
  () => new TorusGeometry(1, 0.3, 6, 10), () => new PlaneGeometry(2, 2, 4, 4),
];

describe("mesh operations on random meshes", () => {
  it("keep a manifold, conserve the surface and never fail with an internal error", () => {
    const next = random(777), problems: Problems = new Map();
    let successes = 0;
    for (let iteration = 0; iteration < 500; iteration += 1) {
      const source = pick(PRIMITIVES, next)?.();
      if (!source) continue;
      let mesh: PolygonMesh;
      try { mesh = readTopology(source); } catch { source.dispose(); continue; }
      const history: string[] = [];
      for (let step = 0; step < 4; step += 1) {
        const faceCount = mesh.faces.length, edges = [...topology(mesh).edges.keys()];
        const before = measureSurface(mesh);
        const closed = (() => { try { return checkManifold(mesh).closed; } catch { return false; } })();
        const randomPlane = () => ({ point: new Vector3((next() - 0.5) * 1.2, (next() - 0.5) * 1.2, (next() - 0.5) * 1.2), normal: new Vector3(next() - 0.5, next() - 0.5, next() - 0.5) });
        const face = () => String(Math.floor(next() * faceCount));
        const choice = Math.floor(next() * 12);
        const names = ["knife", "loopCut", "bisect", "bisectKeep", "delete", "flip", "triangulate", "merge", "dissolve", "subdivide", "correctNormals", "inset"];
        const name = names[choice] ?? "?";
        // Operations that move no surface must also leave its area and volume alone.
        const conserves = name === "knife" || name === "loopCut" || name === "bisect" || name === "triangulate";
        const opens = name === "bisectKeep" || name === "delete";
        let result: PolygonMesh | undefined;
        try {
          if (choice === 0) {
            const faceId = Math.floor(next() * faceCount), corners = mesh.faces[faceId] ?? [];
            const onBoundary = (): KnifePoint => {
              const i = Math.floor(next() * corners.length), a = corners[i] ?? 0, b = corners[(i + 1) % corners.length] ?? 0;
              return next() < 0.3 ? { vertex: String(a) } : { edge: a < b ? `${a}_${b}` : `${b}_${a}`, factor: 0.1 + next() * 0.8 };
            };
            result = knifeChord(mesh, faceId, onBoundary(), onBoundary(), source).mesh;
          } else if (choice === 1) result = loopCut(mesh, pick(edges, next) ?? "0_1", 1 + Math.floor(next() * 3), 0.5).mesh;
          else if (choice === 2) result = bisectMesh(mesh, source, randomPlane()).mesh;
          else if (choice === 3) result = bisectMesh(mesh, source, randomPlane(), { keep: next() < 0.5 ? "positive" : "negative", fill: next() < 0.7 }).mesh;
          else if (choice === 4) result = deleteComponents(mesh, "face", [...new Set(Array.from({ length: 1 + Math.floor(next() * 3) }, face))]).mesh;
          else if (choice === 5) result = flipNormals(mesh, next() < 0.5 ? undefined : [face()]).mesh;
          else if (choice === 6) result = triangulateFaces(mesh, next() < 0.5 ? undefined : [face()]).mesh;
          else if (choice === 7) result = mergeVertices(mesh, (pick(edges, next) ?? "0_1").split("_"), "center").mesh;
          else if (choice === 8) result = dissolveEdges(mesh, [pick(edges, next) ?? "0_1"], source).mesh;
          else if (choice === 9) result = subdivideFaces(mesh, [face()]).mesh;
          else if (choice === 10) result = correctNormals(mesh, next() < 0.5 ? "consistent" : "outward").mesh;
          else {
            const boundary = edges.filter((key) => topology(mesh).edges.get(key)?.length === 1);
            result = next() < 0.5 && boundary.length >= 3 ? fillHole(mesh, boundary.slice(0, 64)).mesh : insetFaces(mesh, [face()], { thickness: 0.05 + next() * 0.1 }).mesh;
          }
        } catch (error) {
          if (internalError(error)) record(problems, `${name}: ${messageOf(error)}`, history.join(" > "));
          break;
        }
        successes += 1;
        history.push(name);
        const broken = channelProblem(result);
        if (broken) record(problems, `${name}: ${broken}`, history.join(" > "));
        try {
          const report = checkManifold(result);
          if (closed && !report.closed && !opens && name !== "inset" && name !== "correctNormals") record(problems, `${name}: a closed mesh became open`, history.join(" > "));
        } catch (error) { record(problems, `${name}: result is not manifold (${messageOf(error)})`, history.join(" > ")); }
        if (conserves && closed) {
          const after = measureSurface(result);
          if (Math.abs(after.area - before.area) > 1e-6 * Math.max(1, before.area) || Math.abs(after.volume - before.volume) > 1e-6 * Math.max(1, Math.abs(before.volume))) {
            record(problems, `${name}: surface or volume changed`, history.join(" > "));
          }
        }
        mesh = result;
      }
      source.dispose();
    }
    expect(Object.fromEntries(problems)).toEqual({});
    expect(successes).toBeGreaterThan(600);
  });
});

describe("plane cuts through concave prisms", () => {
  it("handle planes through vertices, edges and faces, and conserve the volume", () => {
    const next = random(4242), problems: Problems = new Map();
    const directions: [number, number][] = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
    const normals: [number, number, number][] = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 0], [1, -1, 0], [1, 0, 1], [0, 1, 1], [1, 1, 1], [1, 2, 0], [0.3, 1, 0.2]];
    let cuts = 0;
    for (let iteration = 0; iteration < 600; iteration += 1) {
      // A star-shaped outline on the lattice (one corner per compass direction, random reach) is always simple.
      const everyDirection = next() < 0.4;
      const outline = directions.filter(() => everyDirection || next() < 0.75).map(([dx, dy]) => { const reach = 1 + Math.floor(next() * 3); return [dx * reach, dy * reach] as [number, number]; });
      if (outline.length < 3) continue;
      const n = outline.length;
      let geometry: BufferGeometry;
      try {
        const vertices = [...outline.map(([x, y]) => [x, y, 0]), ...outline.map(([x, y]) => [x, y, 2])];
        const faces = [outline.map((_, i) => n + i), outline.map((_, i) => i).reverse(), ...outline.map((_, i) => [i, (i + 1) % n, n + ((i + 1) % n), n + i])];
        geometry = createPolygonMesh(vertices, faces);
      } catch { continue; }
      const mesh = readTopology(geometry), total = measureSurface(mesh);
      const [nx, ny, nz] = pick(normals, next) ?? [0, 1, 0];
      const normal = new Vector3(nx, ny, nz).multiplyScalar(next() < 0.5 ? 1 : -1);
      const point = new Vector3((Math.floor(next() * 7) - 3) * 0.5, (Math.floor(next() * 7) - 3) * 0.5, (Math.floor(next() * 5) - 1) * 0.5);
      const label = `${JSON.stringify(outline)} normal ${normal.toArray().join(",")} point ${point.toArray().join(",")}`;
      const mode = Math.floor(next() * 4);
      try {
        if (mode === 0) {
          const cut = bisectMesh(mesh, geometry, { point, normal });
          const after = measureSurface(cut.mesh), unit = normal.clone().normalize(), offset = unit.dot(point);
          if (Math.abs(after.area - total.area) > 1e-6 || Math.abs(after.volume - total.volume) > 1e-6) record(problems, "cut changed the surface", label);
          if (cut.mesh.positions.slice(mesh.positions.length).some((p) => Math.abs(unit.dot(p) - offset) > 1e-6)) record(problems, "a new vertex is off the plane", label);
          if (!checkManifold(cut.mesh, true).closed) record(problems, "cut left the solid open", label);
        } else if (mode === 1 || mode === 2) {
          const one = bisectMesh(mesh, geometry, { point, normal }, { keep: "positive", fill: true }), two = bisectMesh(mesh, geometry, { point, normal }, { keep: "negative", fill: true });
          checkManifold(one.mesh, true); checkManifold(two.mesh, true);
          if (Math.abs(measureSurface(one.mesh).volume + measureSurface(two.mesh).volume - total.volume) > 1e-6) record(problems, "halves do not add up to the solid", label);
        } else {
          const subset = new Set<number>([Math.floor(next() * mesh.faces.length), Math.floor(next() * mesh.faces.length)]);
          const cut = bisectMesh(mesh, geometry, { point, normal }, { faces: subset });
          checkManifold(cut.mesh, true);
          if (Math.abs(measureSurface(cut.mesh).volume - total.volume) > 1e-6) record(problems, "a partial cut changed the volume", label);
        }
        cuts += 1;
      } catch (error) {
        if (internalError(error)) record(problems, `internal error: ${messageOf(error)}`, label);
        // A refusal is allowed only when it explains itself.
        else if (/untriangulatable|coincident/.test(messageOf(error))) record(problems, `unexplained refusal: ${messageOf(error)}`, label);
      }
      geometry.dispose();
    }
    expect(Object.fromEntries(problems)).toEqual({});
    expect(cuts).toBeGreaterThan(400);
  });
});
