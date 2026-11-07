import { describe, expect, it } from "vitest";
import { BoxGeometry, CylinderGeometry, SphereGeometry, Vector3, type BufferGeometry } from "three";
import { shadeGeometry } from "./meshShading";
import { readTopology } from "./meshTopology";

/** The three normals at the corners of every rendered triangle. */
function triangleNormals(geometry: BufferGeometry): Vector3[][] {
  const normals = geometry.getAttribute("normal"), index = geometry.index;
  const count = (index?.count ?? normals.count) / 3, result: Vector3[][] = [];
  for (let t = 0; t < count; t += 1) {
    result.push([0, 1, 2].map((c) => new Vector3().fromBufferAttribute(normals, index ? index.getX(t * 3 + c) : t * 3 + c)));
  }
  return result;
}
function cornerPositions(geometry: BufferGeometry): { position: Vector3; normal: Vector3 }[] {
  const position = geometry.getAttribute("position"), normal = geometry.getAttribute("normal"), index = geometry.index;
  const count = index?.count ?? position.count;
  return Array.from({ length: count }, (_, i) => { const v = index ? index.getX(i) : i; return { position: new Vector3().fromBufferAttribute(position, v), normal: new Vector3().fromBufferAttribute(normal, v) }; });
}

describe("shading", () => {
  it("gives every face its own normal when flat", () => {
    const source = new SphereGeometry(1, 10, 8), mesh = readTopology(source);
    const flat = shadeGeometry(source, mesh, { mode: "flat" });
    for (const corners of triangleNormals(flat)) {
      expect(corners[0]?.distanceTo(corners[1] ?? new Vector3())).toBeLessThan(1e-6);
      expect(corners[0]?.distanceTo(corners[2] ?? new Vector3())).toBeLessThan(1e-6);
    }
    expect(readTopology(flat).faces).toEqual(mesh.faces);
  });

  it("blends the faces around a corner when smooth", () => {
    const source = new BoxGeometry(1, 1, 1), mesh = readTopology(source);
    for (const { position, normal } of cornerPositions(shadeGeometry(source, mesh, { mode: "smooth" }))) {
      expect(normal.dot(position.clone().normalize())).toBeGreaterThan(0.999);
    }
  });

  it("keeps the cage, so the next edit sees the same face and vertex numbers", () => {
    const source = new SphereGeometry(1, 10, 8), mesh = readTopology(source);
    for (const choice of [{ mode: "flat" }, { mode: "smooth" }, { mode: "smooth", angle: 40 }] as const) {
      const shaded = shadeGeometry(source, mesh, choice);
      expect(readTopology(shaded).faces).toBe(mesh.faces);
      expect(readTopology(shaded).positions).toBe(mesh.positions);
    }
  });

  it("keeps edges sharper than the angle crisp: a cube stays faceted, a cylinder is round at its side and crisp at its caps", () => {
    const box = new BoxGeometry(1, 1, 1), boxMesh = readTopology(box);
    for (const corners of triangleNormals(shadeGeometry(box, boxMesh, { mode: "smooth", angle: 30 }))) {
      expect(corners[0]?.distanceTo(corners[1] ?? new Vector3())).toBeLessThan(1e-6);
    }
    const tube = new CylinderGeometry(1, 1, 2, 12, 1), tubeMesh = readTopology(tube);
    const shaded = cornerPositions(shadeGeometry(tube, tubeMesh, { mode: "smooth", angle: 40 }));
    let sides = 0, caps = 0;
    for (const { position, normal } of shaded) {
      if (Math.abs(normal.y) > 0.999) { caps += 1; continue; } // a cap corner keeps the cap's own normal
      sides += 1;
      // A side corner points straight out from the axis, smooth around the tube even on the rim.
      expect(Math.abs(normal.y)).toBeLessThan(1e-6);
      expect(normal.clone().setY(0).normalize().dot(position.clone().setY(0).normalize())).toBeGreaterThan(0.999);
    }
    expect(sides).toBeGreaterThan(0);
    expect(caps).toBeGreaterThan(0);
  });

  it("rounds a sphere completely when the angle is above its facet angle", () => {
    const source = new SphereGeometry(1, 16, 12), mesh = readTopology(source);
    for (const { position, normal } of cornerPositions(shadeGeometry(source, mesh, { mode: "smooth", angle: 60 }))) {
      expect(normal.dot(position.clone().normalize())).toBeGreaterThan(0.97);
    }
  });
});
