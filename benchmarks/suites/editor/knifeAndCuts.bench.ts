/*
 * BENCH: The assistant's knife and mesh-cut commands on a base cage
 * TIER: HIGH
 * SUBJECT: apps/desktop/src/features/meshGeometry/meshKnifeChord.ts#knifeChord, meshKnifeSession.ts#KnifeSession,
 *          meshBisect.ts#bisectMesh, meshDelete.ts#deleteComponents, meshFlip.ts#flipNormals,
 *          meshRegions.ts#boundaryLoops and #shellSummaries (what inspect_mesh openings/shells walk), meshShading.ts#shadeGeometry (the write of a whole cage with new normals), meshBridge.ts#bridgeEdgeLoops,
 *          meshTopologyEdit.ts#validateTopologyEdit
 * MEASURES: latency
 * COMPLEXITY: O(faces) for every case: a cut walks the face list once, and the whole-cage validation does too.
 *             A 30-cut knife path checks the cage once at the end, so it is also O(faces), not O(faces x cuts) like
 *             the validated-after-each-cut path was.
 * INPUTS: quad grids of 1,024 / 4,096 / 16,384 faces (a flat cage the editor keeps as quads); UV spheres of about
 *         1.5k / 6k / 19.8k triangles (the editor's input limit is 20k); seed-free, generated from the sizes
 * BASELINE: none committed yet; record one on the reference machine with BENCH_UPDATE_BASELINE=1 (numbers only compare on one machine)
 * THRESHOLD: fail if median regresses >25% (and beyond 3x the baseline spread) or p95 >40%
 * EXCLUDES: reading a cage out of a BufferGeometry, writing the result back, modifier re-evaluation, the bridge
 * NOTES: every case starts from a cage that has not been validated before, so the first edit pays for the whole-cage
 *        checks. A second edit on the same cage skips the checks of faces it did not touch (see meshTopologyEdit.ts).
 *        Before the cut-path work a 32-cut path on 1,024 faces took 269 ms, and a 64-cut path on 4,096 faces was
 *        refused outright by a work budget that its own documented limit contradicted.
 */
import { it } from "vitest";
import { SphereGeometry, Vector3, type BufferGeometry } from "three";
import { createPolygonMesh } from "@/features/meshGeometry/createPolygonMesh";
import { bridgeEdgeLoops } from "@/features/meshGeometry/meshBridge";
import { bisectMesh } from "@/features/meshGeometry/meshBisect";
import { deleteComponents } from "@/features/meshGeometry/meshDelete";
import { flipNormals } from "@/features/meshGeometry/meshFlip";
import { boundaryLoops, shellSummaries } from "@/features/meshGeometry/meshRegions";
import { shadeGeometry } from "@/features/meshGeometry/meshShading";
import { knifeChord } from "@/features/meshGeometry/meshKnifeChord";
import { KnifeSession } from "@/features/meshGeometry/meshKnifeSession";
import { readTopology, topology, type PolygonMesh } from "@/features/meshGeometry/meshTopology";
import { validateTopologyEdit } from "@/features/meshGeometry/meshTopologyEdit";
import { measureCases, type BenchCase } from "../../lib/harness";
import { finishWithGrowth } from "../../lib/report";
import { consume } from "../../lib/sink";

interface Grid { size: number; source: BufferGeometry; mesh: PolygonMesh }
function grid(size: number): Grid {
  const vertices: number[][] = [], faces: number[][] = [];
  for (let y = 0; y <= size; y += 1) for (let x = 0; x <= size; x += 1) vertices.push([x, y, 0]);
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
    const a = y * (size + 1) + x;
    faces.push([a, a + 1, a + size + 2, a + size + 1]);
  }
  const source = createPolygonMesh(vertices, faces);
  return { size, source, mesh: readTopology(source) };
}
/** Cuts across the first `count` cells of the bottom row; every cut starts where the previous one ended. */
function rowSegments(size: number, count: number) {
  const first = (size + 1) ** 2;
  return Array.from({ length: count }, (_, k) => ({
    face: 2 * k,
    start: k === 0 ? { edge: `0_${size + 1}`, factor: 0.5 } : { vertex: String(first + k) },
    end: { edge: `${k + 1}_${k + size + 2}`, factor: 0.5 },
  }));
}

it("measures knife cuts on quad grids", async () => {
  const grids = [32, 64, 128].map(grid);
  const cases: BenchCase[] = grids.flatMap(({ size, source, mesh }) => {
    const params = { faces: mesh.faces.length };
    const segments = rowSegments(size, 30);
    return [
      { name: "knife chord (one cut, checked)", params, run: () => consume(knifeChord(mesh, 0, { edge: `0_${size + 1}`, factor: 0.5 }, { edge: `1_${size + 2}`, factor: 0.5 }, source).mesh.faces.length) },
      { name: "knife path, 30 cuts, checked once", params, run: () => {
        const session = new KnifeSession(mesh, source, { deferValidation: true });
        for (const segment of segments) session.append(segment);
        consume(session.finish().mesh.faces.length);
      } },
    ];
  });
  try {
    const results = await measureCases(cases);
    finishWithGrowth("editor/knifeAndCuts.knife", results, [
      { key: "faces", declared: 1, label: "chord", where: (result) => result.name.startsWith("knife chord") },
      { key: "faces", declared: 1, label: "path", where: (result) => result.name.startsWith("knife path") },
    ]);
  } finally { for (const entry of grids) entry.source.dispose(); }
});

it("measures plane cuts on spheres", async () => {
  const cases: BenchCase[] = [[32, 24], [64, 48], [100, 100]].flatMap(([width, height]) => {
    const source = new SphereGeometry(1, width, height), mesh = readTopology(source);
    const params = { faces: mesh.faces.length };
    const plane = { point: new Vector3(0, 0.1, 0), normal: new Vector3(0, 1, 0) };
    return [
      { name: "bisect (cut only)", params, run: () => consume(bisectMesh(mesh, source, plane).mesh.faces.length) },
      { name: "bisect (keep one side, cap)", params, run: () => consume(bisectMesh(mesh, source, plane, { keep: "positive", fill: true }).mesh.faces.length) },
    ];
  });
  const results = await measureCases(cases);
  finishWithGrowth("editor/knifeAndCuts.bisect", results, [
    { key: "faces", declared: 1, label: "bisect", where: (result) => result.name.startsWith("bisect (cut") },
    { key: "faces", declared: 1, label: "bisect and cap", where: (result) => result.name.startsWith("bisect (keep") },
  ]);
});

it("measures deleting, flipping, shading and validating a whole cage", async () => {
  const cases: BenchCase[] = [[32, 24], [64, 48], [100, 100]].flatMap(([width, height]) => {
    const source = new SphereGeometry(1, width, height), mesh = readTopology(source);
    const params = { faces: mesh.faces.length };
    const patch = Array.from({ length: Math.min(1000, Math.floor(mesh.faces.length / 4)) }, (_, index) => String(index));
    return [
      { name: "delete a patch of up to 1000 faces", params, run: () => consume(deleteComponents(mesh, "face", patch).mesh.faces.length) },
      { name: "flip every face", params, run: () => consume(flipNormals(mesh).mesh.faces.length) },
      { name: "find openings and shells", params, run: () => { const graph = topology(mesh); consume(boundaryLoops(graph).loops.length + shellSummaries(mesh, graph).length); } },
      { name: "shade flat (rewrite the geometry)", params, run: () => consume(shadeGeometry(source, mesh, { mode: "flat" }).getAttribute("normal").count) },
      { name: "shade smooth by angle (rewrite the geometry)", params, run: () => consume(shadeGeometry(source, mesh, { mode: "smooth", angle: 40 }).getAttribute("normal").count) },
      { name: "validate a candidate (new cage each time)", params, run: () => {
        const candidate: PolygonMesh = { ...mesh, faces: mesh.faces.map((face) => [...face]) };
        validateTopologyEdit(candidate, candidate);
        consume(candidate.faces.length);
      } },
    ];
  });
  const results = await measureCases(cases);
  finishWithGrowth("editor/knifeAndCuts.faces", results, [
    { key: "faces", declared: 1, label: "delete", where: (result) => result.name.startsWith("delete") },
    { key: "faces", declared: 1, label: "flip", where: (result) => result.name.startsWith("flip") },
    { key: "faces", declared: 1, label: "validate", where: (result) => result.name.startsWith("validate") },
    { key: "faces", declared: 1, label: "regions", where: (result) => result.name.startsWith("find openings") },
    { key: "faces", declared: 1, label: "shade flat", where: (result) => result.name.startsWith("shade flat") },
    { key: "faces", declared: 1, label: "shade by angle", where: (result) => result.name.startsWith("shade smooth") },
  ]);
});

/** Two open tubes with different side counts, one above the other, and the edges of the two rims that face each other. */
function twoTubes(lowSides: number, highSides: number) {
  const ring = (sides: number, y: number) => Array.from({ length: sides }, (_, i) => [Math.cos((i / sides) * 2 * Math.PI), y, Math.sin((i / sides) * 2 * Math.PI)]);
  const band = (sides: number, at: number) => Array.from({ length: sides }, (_, i) => [at + i, at + ((i + 1) % sides), at + sides + ((i + 1) % sides), at + sides + i]);
  const source = createPolygonMesh([...ring(lowSides, 0), ...ring(lowSides, 1), ...ring(highSides, 2), ...ring(highSides, 3)], [...band(lowSides, 0), ...band(highSides, 2 * lowSides)]);
  const mesh = readTopology(source);
  const at = (y: number) => [...topology(mesh).edges].filter(([, incident]) => incident.length === 1 && incident.every((half) => Math.abs((mesh.positions[half.from]?.y ?? Number.NaN) - y) < 1e-9)).map(([id]) => id);
  return { source, mesh, edges: [...at(1), ...at(2)] };
}

it("measures bridging two openings, up to the 256-edge loop limit", async () => {
  const sweep = (name: string, pairs: readonly (readonly [number, number])[]): BenchCase[] => pairs.map(([low, high]) => {
    const { mesh, edges } = twoTubes(low, high);
    return { name, params: { edges: edges.length }, run: () => consume(bridgeEdgeLoops(mesh, edges).mesh.faces.length) };
  });
  const results = await measureCases([
    ...sweep("bridge two equal loops", [[16, 16], [32, 32], [64, 64], [128, 128], [256, 256]]),
    ...sweep("bridge two unequal loops", [[16, 12], [32, 24], [64, 48], [128, 100], [256, 200]]),
  ]);
  // Equal loops are paired by trying each turn of one against the other; unequal loops also try each start of the longer.
  finishWithGrowth("editor/knifeAndCuts.bridge", results, [
    { key: "edges", declared: 2, tolerance: 0.5, label: "equal loops", where: (result) => result.name.includes("equal loops") && !result.name.includes("unequal") },
    { key: "edges", declared: 3, tolerance: 0.5, label: "unequal loops", where: (result) => result.name.includes("unequal") },
  ]);
});
