import { describe, expect, it } from "vitest";
import { BoxGeometry, CylinderGeometry, Float32BufferAttribute, SphereGeometry, TorusGeometry, Vector3, type BufferGeometry } from "three";
import { bisectMesh } from "./meshBisect";
import { createPolygonMesh } from "./createPolygonMesh";
import { checkManifold } from "./meshManifold";
import { evaluate } from "./meshWeights";
import { faceAreaNormal, readTopology, type PolygonMesh } from "./meshTopology";
import { measureSurface as measure } from "./meshTestSupport";

const plane = (axis: "x" | "y" | "z", at: number) => ({
  point: new Vector3(axis === "x" ? at : 0, axis === "y" ? at : 0, axis === "z" ? at : 0),
  normal: new Vector3(axis === "x" ? 1 : 0, axis === "y" ? 1 : 0, axis === "z" ? 1 : 0),
});
/** A prism over a polygon outline (counter-clockwise seen from +z), one quad per outline edge. */
function prism(outline: readonly (readonly [number, number])[]): BufferGeometry {
  const n = outline.length;
  const vertices = [...outline.map(([x, y]) => [x, y, 0]), ...outline.map(([x, y]) => [x, y, 1])];
  const top = outline.map((_, i) => n + i);
  const faces = [top, [...Array.from({ length: n }, (_, i) => i)].reverse(),
    ...outline.map((_, i) => [i, (i + 1) % n, n + ((i + 1) % n), n + i])];
  return createPolygonMesh(vertices, faces);
}
const U_SHAPE: [number, number][] = [[0, 0], [3, 0], [3, 2], [2, 2], [2, 1], [1, 1], [1, 2], [0, 2]];
function expectClosedSolid(mesh: PolygonMesh): void {
  expect(checkManifold(mesh, true).closed).toBe(true);
  for (const face of mesh.faces) expect(faceAreaNormal(mesh, face).lengthSq()).toBeGreaterThan(1e-18);
}

describe("bisect", () => {
  it("cuts a cube across its middle without opening a crack", () => {
    const geometry = new BoxGeometry(1, 1, 1), mesh = readTopology(geometry), before = measure(mesh);
    const result = bisectMesh(mesh, geometry, plane("y", 0));
    expect(result.mesh.faces).toHaveLength(10);
    expect(result.mesh.positions).toHaveLength(12);
    expect(result.split).toBe(4);
    expectClosedSolid(result.mesh);
    const after = measure(result.mesh);
    expect(after.area).toBeCloseTo(before.area, 6);
    expect(after.volume).toBeCloseTo(before.volume, 6);
    expect(result.selection).toHaveLength(4);
    // Every new vertex sits on the plane.
    result.mesh.positions.slice(8).forEach((p) => expect(p.y).toBeCloseTo(0, 6));
  });

  it("refuses a plane that misses the mesh and says where the mesh is", () => {
    const geometry = new BoxGeometry(1, 1, 1), mesh = readTopology(geometry);
    expect(() => bisectMesh(mesh, geometry, plane("y", 3))).toThrow(/does not cut the mesh.*-3\.5 to -2\.5/);
    // Touching the top face from outside, or lying in it, changes nothing.
    expect(() => bisectMesh(mesh, geometry, plane("y", 0.5))).toThrow("does not cut");
  });

  it("says so when the plane runs along existing edges instead of claiming it misses the mesh", () => {
    // A sphere has a ring of vertices on its equator: a plane there crosses no face.
    const geometry = new SphereGeometry(1, 16, 12), mesh = readTopology(geometry);
    expect(() => bisectMesh(mesh, geometry, plane("y", 0))).toThrow("already runs along existing edges");
    // A position between two rings does cut.
    expect(bisectMesh(mesh, geometry, plane("y", 0.1)).split).toBeGreaterThan(0);
    // Outside the mesh is still reported as a miss, with the distances.
    expect(() => bisectMesh(mesh, geometry, plane("y", 3))).toThrow("does not cut the mesh");
  });

  it("uses vertices on the plane instead of creating slivers", () => {
    const geometry = new BoxGeometry(1, 1, 1), mesh = readTopology(geometry);
    // x + y = 0 passes through two opposite vertical edges: the top and bottom split along their diagonals.
    const result = bisectMesh(mesh, geometry, { point: new Vector3(), normal: new Vector3(1, 1, 0) });
    expect(result.mesh.positions).toHaveLength(8);
    expect(result.mesh.faces).toHaveLength(8);
    expectClosedSolid(result.mesh);
    expect(measure(result.mesh).volume).toBeCloseTo(1, 6);
  });

  it("snaps a plane that is within the snap distance of a vertex plane", () => {
    const geometry = new BoxGeometry(1, 1, 1, 2, 2, 2), mesh = readTopology(geometry);
    const exact = bisectMesh(mesh, geometry, plane("y", 0));
    const nearly = bisectMesh(mesh, geometry, plane("y", 1e-8));
    expect(nearly.mesh.positions).toHaveLength(exact.mesh.positions.length);
    expect(nearly.mesh.faces).toHaveLength(exact.mesh.faces.length);
    const wide = bisectMesh(mesh, geometry, plane("y", 0.004), { snapDistance: 0.01 });
    expect(wide.mesh.positions).toHaveLength(exact.mesh.positions.length);
  });

  it("keeps one side and caps the opening so a sphere becomes a closed hemisphere", () => {
    const geometry = new SphereGeometry(1, 16, 12), mesh = readTopology(geometry), whole = measure(mesh);
    const half = bisectMesh(mesh, geometry, plane("y", 0), { keep: "positive", fill: true });
    expectClosedSolid(half.mesh);
    expect(half.capped).toBe(1);
    expect(measure(half.mesh).volume).toBeCloseTo(whole.volume / 2, 1);
    for (const p of half.mesh.positions) expect(p.y).toBeGreaterThan(-1e-6);
    // The cap faces down, away from the kept half.
    const cap = half.mesh.faces[half.mesh.faces.length - 1] ?? [];
    expect(faceAreaNormal(half.mesh, cap).y).toBeLessThan(0);
    const lower = bisectMesh(mesh, geometry, plane("y", 0), { keep: "negative", fill: true });
    expectClosedSolid(lower.mesh);
    expect(faceAreaNormal(lower.mesh, lower.mesh.faces[lower.mesh.faces.length - 1] ?? []).y).toBeGreaterThan(0);
    expect(measure(half.mesh).volume + measure(lower.mesh).volume).toBeCloseTo(whole.volume, 5);
  });

  it("leaves the opening open without fill, and only then allows an open result", () => {
    const geometry = new CylinderGeometry(1, 1, 2, 12, 2), mesh = readTopology(geometry);
    const open = bisectMesh(mesh, geometry, plane("y", 0.25), { keep: "negative" });
    expect(checkManifold(open.mesh).closed).toBe(false);
    expect(open.capped).toBe(0);
    const closed = bisectMesh(mesh, geometry, plane("y", 0.25), { keep: "negative", fill: true });
    expectClosedSolid(closed.mesh);
  });

  it("refuses to keep a side when nothing would remain or change", () => {
    const geometry = new BoxGeometry(1, 1, 1), mesh = readTopology(geometry);
    expect(() => bisectMesh(mesh, geometry, plane("y", 2), { keep: "negative" })).toThrow("does not cut");
    expect(() => bisectMesh(mesh, geometry, plane("y", -2), { keep: "negative" })).toThrow(/Nothing would remain|does not cut/);
  });

  it("pairs the crossings of a concave polygon along the cutting line", () => {
    const geometry = prism(U_SHAPE), mesh = readTopology(geometry), before = measure(mesh);
    const result = bisectMesh(mesh, geometry, plane("y", 1.5));
    expectClosedSolid(result.mesh);
    const after = measure(result.mesh);
    expect(after.area).toBeCloseTo(before.area, 6);
    expect(after.volume).toBeCloseTo(before.volume, 6);
    // Top and bottom each split into three pieces: two arm tips and the body.
    const flat = result.mesh.faces.filter((face) => face.every((id) => result.mesh.positions[id]?.z === 0));
    expect(flat).toHaveLength(3);
  });

  it("caps each separate outline of a concave cut and refuses an outline inside another", () => {
    const u = prism(U_SHAPE), uMesh = readTopology(u);
    const arms = bisectMesh(uMesh, u, plane("y", 1.5), { keep: "negative", fill: true });
    expectClosedSolid(arms.mesh);
    // The plane meets both arms, so the cut has two separate outlines whichever side is kept.
    expect(arms.capped).toBe(2);
    const tips = bisectMesh(uMesh, u, plane("y", 1.5), { keep: "positive", fill: true });
    expectClosedSolid(tips.mesh);
    expect(tips.capped).toBe(2);
    expect(measure(tips.mesh).volume + measure(arms.mesh).volume).toBeCloseTo(measure(uMesh).volume, 6);
    const ring = new TorusGeometry(1, 0.3, 8, 16), ringMesh = readTopology(ring);
    // The plane through a torus's axis gives two separate outlines; a plane across it gives an annulus.
    expectClosedSolid(bisectMesh(ringMesh, ring, plane("x", 0.01), { keep: "positive", fill: true }).mesh);
    expect(() => bisectMesh(ringMesh, ring, plane("z", 0.01), { keep: "positive", fill: true })).toThrow("nest");
  });

  it("splits only the chosen faces and still puts the shared vertex into their neighbours", () => {
    const geometry = createPolygonMesh([[0, 0, 0], [1, 0, 0], [2, 0, 0], [0, 1, 0], [1, 1, 0], [2, 1, 0]], [[0, 1, 4, 3], [1, 2, 5, 4]]);
    const mesh = readTopology(geometry);
    const result = bisectMesh(mesh, geometry, { point: new Vector3(1.5, 0, 0), normal: new Vector3(1, 0, 0) }, { faces: new Set([1]) });
    // Face 1 is cut in two; face 0 only gains no vertex because the plane crosses its neighbour alone.
    expect(result.mesh.faces).toHaveLength(3);
    const crossing = bisectMesh(mesh, geometry, { point: new Vector3(0.5, 0, 0), normal: new Vector3(1, 0, 0) }, { faces: new Set([0]) });
    expect(crossing.mesh.faces).toHaveLength(3);
    expect(() => bisectMesh(mesh, geometry, plane("x", 0.5), { faces: new Set([9]) })).toThrow("does not exist");
  });

  it("interpolates texture coordinates and keeps materials", () => {
    const base = new BoxGeometry(1, 1, 1), uv = base.getAttribute("uv");
    const geometry = base.toNonIndexed();
    geometry.setAttribute("uv", new Float32BufferAttribute(Array.from({ length: geometry.getAttribute("position").count }, (_, i) => [i % 3, 0]).flat(), 2));
    const mesh = readTopology(base);
    const result = bisectMesh(mesh, base, plane("y", 0));
    expect(uv?.count).toBeGreaterThan(0);
    // A box has one material per side: each cut side keeps its material on both pieces.
    const perMaterial = new Map<number, number>();
    for (const material of result.mesh.channels?.materials ?? []) perMaterial.set(material, (perMaterial.get(material) ?? 0) + 1);
    expect([...perMaterial.entries()].sort((a, b) => a[0] - b[0])).toEqual([[0, 2], [1, 2], [2, 1], [3, 1], [4, 2], [5, 2]]);
    const samples = result.mesh.channels?.corners ?? [];
    expect(samples.every((corners, index) => corners.length === result.mesh.faces[index]?.length)).toBe(true);
    const u = base.getAttribute("uv");
    // A side face's new corner is halfway up, so its v coordinate is the mean of the two it was cut between.
    const found = result.mesh.faces.flatMap((face, index) => face.flatMap((id, corner) => id >= 8 ? [evaluate(u, samples[index]?.[corner] ?? new Map(), 1)] : []));
    expect(found.length).toBeGreaterThan(0);
    for (const value of found) expect(value).toBeCloseTo(0.5, 5);
  });

  it("cuts a tilted plane through a sphere and conserves the surface", () => {
    const geometry = new SphereGeometry(1, 24, 16), mesh = readTopology(geometry), before = measure(mesh);
    const result = bisectMesh(mesh, geometry, { point: new Vector3(0.1, 0.05, 0), normal: new Vector3(1, 2, -0.5) });
    expectClosedSolid(result.mesh);
    expect(measure(result.mesh).area).toBeCloseTo(before.area, 5);
    expect(measure(result.mesh).volume).toBeCloseTo(before.volume, 5);
  });

  it("rejects an invalid plane and refuses fill without a side to keep", () => {
    const geometry = new BoxGeometry(), mesh = readTopology(geometry);
    expect(() => bisectMesh(mesh, geometry, { point: new Vector3(), normal: new Vector3() })).toThrow("nonzero normal");
    expect(() => bisectMesh(mesh, geometry, plane("y", 0), { fill: true })).toThrow("keep");
    expect(() => bisectMesh(mesh, geometry, plane("y", 0), { keep: "positive", faces: new Set([0]) })).toThrow("cannot be limited");
  });

  describe("planes that touch a polygon instead of crossing it", () => {
    // Found by fuzzing: each of these once produced a sliver, a polygon touching itself, or a refusal.
    const star = [[2, 0], [2, 2], [0, 3], [-3, 3], [-3, 0], [-3, -3], [0, -3], [2, -2]] as [number, number][];
    const hook = [[3, 0], [3, 3], [0, 1], [-2, 2], [-1, 0], [-1, -1], [0, -1], [3, -3]] as [number, number][];
    const L_SHAPE: [number, number][] = [[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2]];
    const prismOf = (outline: [number, number][]) => { const geometry = prism(outline); return { geometry, mesh: readTopology(geometry) }; };

    it("leaves a polygon alone when it only touches the plane along a straight run of its edge", () => {
      // The top outline has three collinear corners on x = -3. The plane x + z = -1 meets the top exactly there.
      const { geometry, mesh } = prismOf(star), before = measure(mesh);
      const result = bisectMesh(mesh, geometry, { point: new Vector3(-1.5, -1, 0.5), normal: new Vector3(-1, 0, -1) });
      expectClosedSolid(result.mesh);
      expect(measure(result.mesh).volume).toBeCloseTo(before.volume, 6);
      // No face is a three-corner sliver of collinear points.
      for (const face of result.mesh.faces) expect(faceAreaNormal(result.mesh, face).lengthSq()).toBeGreaterThan(1e-9);
    });

    it("cuts through a corner that lies between the crossings, so the corner joins both sides", () => {
      const { geometry, mesh } = prismOf(hook), total = measure(mesh);
      const through = { point: new Vector3(1, -1.5, 1), normal: new Vector3(-1, -2, 0) };
      const cut = bisectMesh(mesh, geometry, through);
      expectClosedSolid(cut.mesh);
      expect(measure(cut.mesh).volume).toBeCloseTo(total.volume, 6);
      const kept = bisectMesh(mesh, geometry, through, { keep: "positive", fill: true }), other = bisectMesh(mesh, geometry, through, { keep: "negative", fill: true });
      expectClosedSolid(kept.mesh);
      expectClosedSolid(other.mesh);
      expect(measure(kept.mesh).volume + measure(other.mesh).volume).toBeCloseTo(total.volume, 6);
    });

    it("cuts an L-shaped prism through its inner corner", () => {
      const { geometry, mesh } = prismOf(L_SHAPE), total = measure(mesh);
      // x + y = 2 passes through (2, 0), the inner corner (1, 1) and (0, 2).
      const diagonal = { point: new Vector3(1, 1, 0), normal: new Vector3(1, 1, 0) };
      const result = bisectMesh(mesh, geometry, diagonal);
      expectClosedSolid(result.mesh);
      expect(measure(result.mesh).volume).toBeCloseTo(total.volume, 6);
      const halves = [bisectMesh(mesh, geometry, diagonal, { keep: "positive", fill: true }), bisectMesh(mesh, geometry, diagonal, { keep: "negative", fill: true })];
      halves.forEach((half) => expectClosedSolid(half.mesh));
      expect(halves[0] && halves[1] ? measure(halves[0].mesh).volume + measure(halves[1].mesh).volume : 0).toBeCloseTo(total.volume, 6);
    });

    it("says what to do when the plane lies in a face and a cap would duplicate it", () => {
      const geometry = new BoxGeometry(1, 1, 1), mesh = readTopology(geometry);
      expect(() => bisectMesh(mesh, geometry, plane("y", 0.5), { keep: "negative", fill: true })).toThrow(/does not cut|nothing to cap/);
      // The plane through the bottom face keeps only that face on its positive side.
      expect(() => bisectMesh(mesh, geometry, plane("y", -0.5), { keep: "negative", fill: true })).toThrow(/does not cut|nothing to cap|Nothing would remain/);
      const flat = prism([[0, 0], [2, 0], [2, 2], [0, 2]]), flatMesh = readTopology(flat);
      expect(() => bisectMesh(flatMesh, flat, plane("z", 0), { keep: "negative", fill: true })).toThrow("nothing to cap");
    });
  });
});
