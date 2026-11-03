import { describe, expect, it } from "vitest";
import { ExtrudeGeometry, Shape, Vector3, type BufferGeometry } from "three";
import { modifyGeometry, type SubdivisionMethod } from "./meshModifiers";
import { assertManifold, readTopology, topology } from "./meshTopology";

function signedVolume(geometry: BufferGeometry): number {
  const position = geometry.getAttribute("position");
  const index = geometry.index;
  const count = index ? index.count : position.count;
  const at = (i: number): Vector3 => new Vector3().fromBufferAttribute(position, i);
  let volume = 0;
  for (let t = 0; t + 2 < count; t += 3) {
    const a = at(index ? index.getX(t) : t);
    const b = at(index ? index.getX(t + 1) : t + 1);
    const c = at(index ? index.getX(t + 2) : t + 2);
    volume += a.dot(b.clone().cross(c)) / 6;
  }
  return volume;
}

function prism(points: [number, number][]): BufferGeometry {
  const shape = new Shape();
  points.forEach(([x, y], i) => (i === 0 ? shape.moveTo(x, y) : shape.lineTo(x, y)));
  shape.closePath();
  return new ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false, steps: 1 });
}

// Both shapes have a reflex corner whose face-centre falls outside the polygon.
const L_SHAPE: [number, number][] = [[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2]];
const U_SHAPE: [number, number][] = [[0, 0], [3, 0], [3, 3], [2, 3], [2, 1], [1, 1], [1, 3], [0, 3]];
const SHAPES: [string, [number, number][], number][] = [["L", L_SHAPE, 3], ["U", U_SHAPE, 7]];
const METHODS: SubdivisionMethod[] = ["catmull-clark", "linear", "loop"];

describe("subdivision of concave faces", () => {
  for (const [name, points] of SHAPES) {
    for (const method of METHODS) {
      for (const levels of [1, 2]) {
        it(`${method} on the ${name} prism stays a closed manifold at ${levels} level(s)`, () => {
          const output = modifyGeometry(prism(points), { type: "geometry.subdivide", levels, method });
          const mesh = readTopology(output);
          expect(() => assertManifold(mesh, topology(mesh), true)).not.toThrow();
          expect(output.getAttribute("position").array.every(Number.isFinite)).toBe(true);
        });
      }
    }
  }

  for (const [name, points, area] of SHAPES) {
    it(`linear subdivision keeps the ${name} prism volume exactly`, () => {
      const output = modifyGeometry(prism(points), { type: "geometry.subdivide", levels: 2, method: "linear" });
      expect(signedVolume(output)).toBeCloseTo(area, 6);
    });

    it(`Catmull-Clark shrinks the ${name} prism toward its limit without inverting it`, () => {
      const base = signedVolume(prism(points));
      const first = signedVolume(modifyGeometry(prism(points), { type: "geometry.subdivide", levels: 1, method: "catmull-clark" }));
      const second = signedVolume(modifyGeometry(prism(points), { type: "geometry.subdivide", levels: 2, method: "catmull-clark" }));
      expect(base).toBeCloseTo(area, 6);
      expect(first).toBeGreaterThan(0);
      expect(second).toBeGreaterThan(0);
      expect(second).toBeLessThan(first);
      expect(first).toBeLessThan(base);
    });
  }

  it("convex prisms keep their quad output, so existing results do not change", () => {
    const square = prism([[0, 0], [1, 0], [1, 1], [0, 1]]);
    const output = modifyGeometry(square, { type: "geometry.subdivide", levels: 1, method: "linear" });
    // Six quad faces (4 sides, 2 caps) each split into 4 quads: 24 quads = 48 triangles = 144 indices.
    expect(output.index?.count).toBe(144);
  });
});

describe("random star-shaped concave prisms", () => {
  // Deterministic sweep. Closed inputs must subdivide, except Catmull-Clark at a sharp concave tip
  // where the limit surface folds; that case must be refused with the fold message, never a silent result.
  const FOLD = "cannot be triangulated";
  const OPEN = "requires a closed manifold surface";
  it("never refuses a closed concave input for a reason other than a real fold", () => {
    let seed = 2024;
    const random = (): number => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    let checked = 0;
    for (let shapeIndex = 0; shapeIndex < 60; shapeIndex += 1) {
      const count = 5 + Math.floor(random() * 8);
      const angles = Array.from({ length: count }, () => random() * Math.PI * 2).sort((a, b) => a - b);
      const points = angles.map((angle) => { const radius = 0.4 + random() * 0.6; return [Math.cos(angle) * radius, Math.sin(angle) * radius] as [number, number]; });
      const source = prism(points);
      const sourceMesh = readTopology(source);
      let closed = true;
      try { assertManifold(sourceMesh, topology(sourceMesh), true); } catch { closed = false; }
      // Open sources come from three.js's own cap triangulation and are refused with the closed-surface message.
      if (!closed) {
        for (const method of METHODS) expect(() => modifyGeometry(prism(points), { type: "geometry.subdivide", levels: 1, method })).toThrow(OPEN);
        continue;
      }
      checked += 1;
      for (const method of METHODS) {
        let error: string | undefined;
        try { modifyGeometry(prism(points), { type: "geometry.subdivide", levels: 1, method }); } catch (caught) { error = caught instanceof Error ? caught.message : String(caught); }
        if (error === undefined) continue;
        expect(method === "catmull-clark" && error.includes(FOLD), `${method} refused a closed concave prism: ${error}`).toBe(true);
      }
    }
    expect(checked).toBeGreaterThan(40);
  });
});
