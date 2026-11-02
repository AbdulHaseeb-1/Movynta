import { describe, expect, it } from "vitest";
import {
  BoxGeometry,
  DoubleSide,
  IcosahedronGeometry,
  Mesh,
  MeshStandardMaterial,
  Raycaster,
  Vector3,
  type Intersection,
} from "three";
import { accelerateRaycasts, DENSE_TRIANGLES } from "./denseRaycast";

/** A deterministic stream of numbers in [0, 1), so the rays are the same on every run. */
function sequence(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function nearestDistance(mesh: Mesh, raycaster: Raycaster): number | undefined {
  const hits: Intersection[] = [];
  mesh.raycast(raycaster, hits);
  return hits.length === 0 ? undefined : Math.min(...hits.map((hit) => hit.distance));
}

function dense(side?: typeof DoubleSide): Mesh {
  // An icosphere of detail 40 has 20 * 41^2 = 33,620 triangles, above the threshold.
  const mesh = new Mesh(new IcosahedronGeometry(1, 40), new MeshStandardMaterial(side ? { side } : {}));
  mesh.position.set(0.5, -0.25, 0.1);
  mesh.rotation.set(0.3, 0.7, 0.1);
  mesh.scale.set(1.5, 1, 2);
  mesh.updateMatrixWorld(true);
  return mesh;
}

describe("accelerated ray tests on dense meshes", () => {
  it("only applies to meshes dense enough to need it", () => {
    // A patched mesh carries its own ray test; an untouched one uses the class's.
    const small = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial());
    accelerateRaycasts(small);
    expect(Object.keys(small).includes("raycast")).toBe(false);
    const big = dense();
    accelerateRaycasts(big);
    expect(Object.keys(big).includes("raycast")).toBe(true);
    expect(big.geometry.getAttribute("position").count / 3).toBeGreaterThan(DENSE_TRIANGLES);
  });

  it.each([
    ["front-facing material", undefined],
    ["double-sided material", DoubleSide],
  ] as const)("finds the same nearest hit as three.js for a %s", (_label, side) => {
    const reference = dense(side);
    const accelerated = dense(side);
    accelerateRaycasts(accelerated);
    const random = sequence(7);
    let hits = 0;
    for (let ray = 0; ray < 300; ray += 1) {
      const origin = new Vector3(random() * 8 - 4, random() * 8 - 4, 6 + random() * 2);
      const target = new Vector3(random() * 4 - 2, random() * 4 - 2, random() * 2 - 1);
      const raycaster = new Raycaster(origin, target.sub(origin).normalize());
      const expected = nearestDistance(reference, raycaster);
      const actual = nearestDistance(accelerated, raycaster);
      if (expected === undefined) expect(actual).toBeUndefined();
      else {
        hits += 1;
        expect(actual).toBeCloseTo(expected, 4);
      }
    }
    // The rays must really cross the mesh for this to prove anything.
    expect(hits).toBeGreaterThan(40);
  });

  it("reports the object that was hit and a point on the surface", () => {
    const mesh = dense();
    accelerateRaycasts(mesh);
    const hits: Intersection[] = [];
    mesh.raycast(new Raycaster(new Vector3(0.5, -0.25, 8), new Vector3(0, 0, -1)), hits);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.object).toBe(mesh);
    expect(hits[0]?.point.z).toBeGreaterThan(0);
  });

  it("misses when the ray goes past", () => {
    const mesh = dense();
    accelerateRaycasts(mesh);
    const hits: Intersection[] = [];
    mesh.raycast(new Raycaster(new Vector3(40, 40, 8), new Vector3(0, 0, -1)), hits);
    expect(hits).toHaveLength(0);
  });
});
