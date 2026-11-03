import { describe, expect, it } from "vitest";
import {
  BoxGeometry,
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
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

  it("follows a morph target instead of the rest positions", () => {
    const make = (influence: number) => {
      const geometry = new IcosahedronGeometry(1, 40);
      const position = geometry.getAttribute("position");
      const delta = new Float32Array(position.count * 3);
      for (let index = 0; index < position.count; index += 1) delta[index * 3 + 1] = 3;
      geometry.morphAttributes.position = [new Float32BufferAttribute(delta, 3)];
      geometry.morphTargetsRelative = true;
      const mesh = new Mesh(geometry, new MeshStandardMaterial({ side: DoubleSide }));
      mesh.morphTargetInfluences = [influence];
      mesh.updateMatrixWorld(true);
      return mesh;
    };
    const morphed = make(1);
    const rest = make(0);
    const raycaster = new Raycaster(new Vector3(0, 8, 0), new Vector3(0, -1, 0));
    const expected = nearestDistance(morphed, raycaster);
    const resting = nearestDistance(rest, raycaster);
    expect(expected).toBeDefined();
    expect(resting).toBeDefined();
    expect(Math.abs((expected ?? 0) - (resting ?? 0))).toBeGreaterThan(1);
    const accelerated = make(1);
    accelerateRaycasts(accelerated);
    expect(nearestDistance(accelerated, raycaster)).toBeCloseTo(expected ?? -1, 4);
  });

  it("honors draw range and a near plane that hides only the closer hit", () => {
    const triangles = DENSE_TRIANGLES + 2;
    const values = new Float32Array(triangles * 9);
    for (let triangle = 0; triangle < triangles; triangle += 1) {
      const offset = triangle * 9;
      values[offset] = 40;
      values[offset + 1] = triangle;
      values[offset + 3] = 40.2;
      values[offset + 4] = triangle;
      values[offset + 6] = 40;
      values[offset + 7] = triangle + 0.2;
    }
    // A close triangle first, then a farther one on the same ray. The rest sit off to the side.
    values.set([-1, -1, 3, 1, -1, 3, 0, 1, 3], 9);
    values.set([-1, -1, 0, 1, -1, 0, 0, 1, 0], (triangles - 1) * 9);
    const geometry = new BufferGeometry().setAttribute("position", new Float32BufferAttribute(values, 3));
    const raycaster = new Raycaster(new Vector3(0, 0, 5), new Vector3(0, 0, -1));
    const reference = new Mesh(geometry, new MeshStandardMaterial({ side: DoubleSide }));
    const accelerated = new Mesh(geometry.clone(), new MeshStandardMaterial({ side: DoubleSide }));
    accelerateRaycasts(accelerated);
    expect(nearestDistance(accelerated, raycaster)).toBeCloseTo(nearestDistance(reference, raycaster) ?? -1, 4);

    geometry.setDrawRange(0, 3);
    accelerated.geometry.setDrawRange(0, 3);
    const clipped = new Raycaster(new Vector3(0, 0, 5), new Vector3(0, 0, -1));
    expect(nearestDistance(reference, clipped)).toBeUndefined();
    expect(nearestDistance(accelerated, clipped)).toBeUndefined();

    geometry.setDrawRange(0, Infinity);
    accelerated.geometry.setDrawRange(0, Infinity);
    const near = new Raycaster(new Vector3(0, 0, 5), new Vector3(0, 0, -1));
    near.near = 3;
    expect(nearestDistance(reference, near)).toBeCloseTo(5, 4);
    expect(nearestDistance(accelerated, near)).toBeCloseTo(5, 4);
  });

  it("rebuilds its boxes after the positions move", () => {
    const reference = dense();
    const accelerated = dense();
    accelerateRaycasts(accelerated);
    for (const mesh of [reference, accelerated]) {
      const position = mesh.geometry.getAttribute("position");
      for (let index = 0; index < position.count; index += 1) position.setX(index, position.getX(index) + 20);
      position.needsUpdate = true;
    }
    reference.updateMatrixWorld(true);
    const vertex = new Vector3().fromBufferAttribute(reference.geometry.getAttribute("position"), 100).applyMatrix4(reference.matrixWorld);
    const origin = vertex.clone().add(new Vector3(0, 0, 3));
    const raycaster = new Raycaster(origin, vertex.clone().sub(origin).normalize());
    const expected = nearestDistance(reference, raycaster);
    expect(expected).toBeDefined();
    expect(nearestDistance(accelerated, raycaster)).toBeCloseTo(expected ?? -1, 4);
  });
});
