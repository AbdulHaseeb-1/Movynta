import { describe, expect, it } from "vitest";
import { Box3, BoxGeometry, Group, Mesh, MeshBasicMaterial, PerspectiveCamera, Vector3 } from "three";
import { boxToFrame, framePose } from "./framing";

const limits = { minDistance: 0.05, maxDistance: 500 };
const look = { position: new Vector3(5, 4, 7), target: new Vector3() };
const cube = (x: number, size = 1) => {
  const mesh = new Mesh(new BoxGeometry(size, size, size), new MeshBasicMaterial());
  mesh.position.x = x;
  mesh.updateMatrixWorld(true);
  return mesh;
};

describe("framePose", () => {
  it("looks at the center of the box from the direction the camera looked from", () => {
    const box = new Box3(new Vector3(9, 0, 0), new Vector3(11, 2, 2));
    const pose = framePose(box, look, 45, 1, limits);
    expect(pose.target.toArray()).toEqual([10, 1, 1]);
    const before = look.position.clone().normalize();
    const after = pose.position.clone().sub(pose.target).normalize();
    expect(after.distanceTo(before)).toBeLessThan(1e-9);
  });

  it("stands far enough that the whole box is inside the picture, for a wide and a tall view", () => {
    const box = new Box3(new Vector3(-3, -1, -1), new Vector3(3, 1, 1));
    for (const aspect of [2, 0.5]) {
      const pose = framePose(box, look, 45, aspect, limits);
      const camera = new PerspectiveCamera(45, aspect, 0.01, 5000);
      camera.position.copy(pose.position);
      camera.lookAt(pose.target);
      camera.updateMatrixWorld(true);
      for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
        const ndc = new Vector3(x, y, z).project(camera);
        expect(Math.abs(ndc.x)).toBeLessThanOrEqual(1);
        expect(Math.abs(ndc.y)).toBeLessThanOrEqual(1);
      }
    }
  });

  it("keeps the distance within the limits, and copes with a point and with a camera sitting on its target", () => {
    const point = new Box3(new Vector3(1, 1, 1), new Vector3(1, 1, 1));
    const tiny = framePose(point, { position: new Vector3(), target: new Vector3() }, 45, 1, limits);
    expect(tiny.position.distanceTo(tiny.target)).toBeGreaterThan(0.05);
    const huge = framePose(new Box3(new Vector3(-1e5, 0, 0), new Vector3(1e5, 1, 1)), look, 45, 1, limits);
    expect(huge.position.distanceTo(huge.target)).toBeCloseTo(500, 6);
  });
});

describe("boxToFrame", () => {
  const source = (objects: Record<string, Mesh>, selectedIds: string[]) => ({
    selectedIds,
    getObject: (id: string) => objects[id],
    pickables: () => Object.values(objects),
  });

  it("frames the selected objects, or everything when nothing is selected or all is asked for", () => {
    const objects = { a: cube(0), b: cube(10) };
    expect(boxToFrame(source(objects, ["b"]))?.getCenter(new Vector3()).x).toBeCloseTo(10);
    expect(boxToFrame(source(objects, []))?.getCenter(new Vector3()).x).toBeCloseTo(5);
    expect(boxToFrame(source(objects, ["b"]), "all")?.getCenter(new Vector3()).x).toBeCloseTo(5);
  });

  it("leaves out hidden objects, and returns null when nothing is left", () => {
    const objects = { a: cube(0), b: cube(10) };
    objects.b.visible = false;
    expect(boxToFrame(source(objects, []))?.getCenter(new Vector3()).x).toBeCloseTo(0);
    objects.a.visible = false;
    expect(boxToFrame(source(objects, []))).toBeNull();
  });

  it("frames an empty group at its position", () => {
    const group = new Group();
    group.position.set(3, 0, 0);
    group.updateMatrixWorld(true);
    expect(boxToFrame({ selectedIds: ["g"], getObject: () => group, pickables: () => [group] })?.getCenter(new Vector3()).x).toBeCloseTo(3);
  });
});
