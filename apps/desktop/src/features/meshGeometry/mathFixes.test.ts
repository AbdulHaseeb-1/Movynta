import { describe, expect, it } from "vitest";
import { BoxGeometry, BufferGeometry, Float32BufferAttribute, PlaneGeometry, Uint16BufferAttribute, Vector3 } from "three";
import { modifyGeometry } from "./meshModifiers";
import { readTopology } from "./meshTopology";

function positionsNear(meshPositions: readonly Vector3[], point: Vector3, limit: number): Vector3[] {
  return meshPositions.filter((position) => position.distanceTo(point) <= limit);
}

describe("weld, dissolve and subdivision masks", () => {
  it("welds by distance, including points that round into different bins and not points that only share a bin", () => {
    const lo = Math.fround(2.5634352596171084e-7);
    const hi = Math.fround(2.6327171553930384e-7);
    const nearOrigin = Math.fround(8.833458764456736e-8);
    const farther = Math.fround(2.580755733561091e-7);
    const epsilon = Math.sqrt(3) * 1e-7;
    expect(lo).not.toBe(hi);
    expect(hi - lo).toBeLessThan(epsilon);
    expect(Math.hypot(farther - nearOrigin, farther - nearOrigin, farther - nearOrigin)).toBeGreaterThan(epsilon);
    const values = [0, 0, 0, 1, 1, 1, 0, 1, 0, lo, 0, 0, hi, 0, 0, nearOrigin, nearOrigin, nearOrigin, farther, farther, farther];
    const geometry = new BufferGeometry().setAttribute("position", new Float32BufferAttribute(values, 3)).setIndex([0, 2, 3, 0, 2, 4, 0, 2, 5, 0, 2, 6]);
    const mesh = readTopology(geometry);
    expect(positionsNear(mesh.positions, new Vector3(lo, 0, 0), epsilon)).toHaveLength(1);
    expect(positionsNear(mesh.positions, new Vector3(hi, 0, 0), epsilon)).toHaveLength(1);
    const absorbed = positionsNear(mesh.positions, new Vector3(nearOrigin, nearOrigin, nearOrigin), epsilon);
    const kept = positionsNear(mesh.positions, new Vector3(farther, farther, farther), epsilon);
    expect(absorbed).toHaveLength(1);
    expect(kept).toHaveLength(1);
    expect(absorbed[0]).not.toBe(kept[0]);
  });

  it("dissolves a coplanar box when skin or a constant color is uniform", () => {
    const skinned = new BoxGeometry(2, 2, 2);
    const count = skinned.getAttribute("position").count;
    skinned.setAttribute("skinIndex", new Uint16BufferAttribute(new Array<number>(count * 4).fill(0), 4));
    const weights = new Array<number>(count * 4).fill(0);
    for (let vertex = 0; vertex < count; vertex += 1) weights[vertex * 4] = 1;
    skinned.setAttribute("skinWeight", new Float32BufferAttribute(weights, 4));
    const skinMesh = readTopology(skinned);
    expect(skinMesh.faces).toHaveLength(6);
    expect(skinMesh.positions).toHaveLength(8);
    const colored = new BoxGeometry(2, 2, 2);
    colored.setAttribute("color", new Float32BufferAttribute(new Array<number>(colored.getAttribute("position").count * 3).fill(0.25), 3));
    expect(readTopology(colored).faces).toHaveLength(6);
    const output = modifyGeometry(skinned, { type: "geometry.subdivide", levels: 1 });
    expect(readTopology(output).positions).toHaveLength(26);
  });

  it("forgets a cached cage when skin is added", () => {
    const box = new BoxGeometry(2, 2, 2);
    const cached = readTopology(box);
    expect(cached.faces).toHaveLength(6);
    const count = box.getAttribute("position").count;
    const joints = new Array<number>(count * 4).fill(0);
    for (let vertex = 0; vertex < count; vertex += 1) joints[vertex * 4] = vertex;
    box.setAttribute("skinIndex", new Uint16BufferAttribute(joints, 4));
    box.setAttribute("skinWeight", new Float32BufferAttribute(new Array<number>(count * 4).fill(0).map((_, index) => (index % 4 === 0 ? 1 : 0)), 4));
    const fresh = readTopology(box);
    expect(fresh).not.toBe(cached);
    expect(fresh.positions).toHaveLength(24);
    expect(cached.positions).toHaveLength(8);
    expect(fresh.faces).toHaveLength(6);
  });

  it("moves a plane corner's UV with the Catmull-Clark boundary mask", () => {
    const output = modifyGeometry(new PlaneGeometry(1, 1), { type: "geometry.subdivide", levels: 1 });
    const position = output.getAttribute("position");
    const uv = output.getAttribute("uv");
    let found = false;
    for (let index = 0; index < position.count; index += 1) {
      if (Math.abs(position.getX(index) + 0.375) > 1e-4 || Math.abs(position.getY(index) - 0.375) > 1e-4) continue;
      found = true;
      expect(uv.getX(index)).toBeCloseTo(0.125, 4);
      expect(uv.getY(index)).toBeCloseTo(0.875, 4);
    }
    expect(found).toBe(true);
  });

  it("uses the interior edge mask for a continuous UV and keeps a seam on its own face", () => {
    const positions = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, -1, 1, 1, -1, 1, 1, 0];
    const smooth = new BufferGeometry()
      .setAttribute("position", new Float32BufferAttribute(positions, 3))
      .setAttribute("uv", new Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 0.2, 1, 0, 2, 0, 2, 0.2, 1, 1], 2))
      .setIndex([0, 1, 2, 0, 2, 3, 7, 4, 5, 7, 5, 6]);
    const output = modifyGeometry(smooth, { type: "geometry.subdivide", levels: 1 });
    const position = output.getAttribute("position");
    const uv = output.getAttribute("uv");
    // The fold stays two triangles, so the shared edge uses the triangle face points: (11/12, 5/12, -1/12).
    const expectedEdge = new Vector3(11 / 12, 5 / 12, -1 / 12);
    let matched = 0;
    for (let index = 0; index < position.count; index += 1) {
      const place = new Vector3(position.getX(index), position.getY(index), position.getZ(index));
      if (place.distanceTo(expectedEdge) > 1e-3) continue;
      matched += 1;
      expect(uv.getX(index)).toBeCloseTo(1, 3);
      expect(uv.getY(index)).toBeCloseTo(5 / 12, 3);
    }
    expect(matched).toBeGreaterThan(0);

    const seam = smooth.clone();
    seam.setAttribute("uv", new Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 0.2, 1, 10, 2, 0, 2, 0.2, 1, 11], 2));
    const seamed = modifyGeometry(seam, { type: "geometry.subdivide", levels: 1 });
    const seamPosition = seamed.getAttribute("position");
    const seamUv = seamed.getAttribute("uv");
    const seamValues: number[] = [];
    for (let index = 0; index < seamPosition.count; index += 1) {
      const place = new Vector3(seamPosition.getX(index), seamPosition.getY(index), seamPosition.getZ(index));
      if (place.distanceTo(expectedEdge) > 1e-3) continue;
      seamValues.push(seamUv.getY(index));
    }
    expect(seamValues.length).toBeGreaterThan(0);
    // Each chart keeps its own endpoints. Blending them would leave V at 5/12.
    expect(seamValues.some((value) => Math.abs(value - 0.5) < 1e-3)).toBe(true);
    expect(seamValues.some((value) => Math.abs(value - 10.5) < 1e-3)).toBe(true);
  });

  it("keeps a negative corrective skin weight", () => {
    const source = new PlaneGeometry(1, 1);
    const count = source.getAttribute("position").count;
    const joints = new Uint16Array(count * 4);
    const weights = new Float32Array(count * 4);
    for (let vertex = 0; vertex < count; vertex += 1) {
      joints[vertex * 4] = 0;
      joints[vertex * 4 + 1] = 1;
      weights[vertex * 4] = 1.25;
      weights[vertex * 4 + 1] = -0.25;
    }
    source.setAttribute("skinIndex", new Uint16BufferAttribute(joints, 4));
    source.setAttribute("skinWeight", new Float32BufferAttribute(weights, 4));
    const output = modifyGeometry(source, { type: "geometry.bevel", width: 0.1 });
    const skin = output.getAttribute("skinWeight");
    expect(skin.getX(0)).toBeCloseTo(1.25, 5);
    expect(skin.getY(0)).toBeCloseTo(-0.25, 5);
  });
});
