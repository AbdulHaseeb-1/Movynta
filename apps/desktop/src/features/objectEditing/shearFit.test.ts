import { describe, expect, it } from "vitest";
import {
  BufferGeometry,
  Float32BufferAttribute,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Scene,
  Vector3,
} from "three";
import { EditorScene } from "../assistant/EditorScene";
import { GroupTransform } from "./groupTransform";
import { assignLocalMatrix, correctWorldRotation, meshVertexWorld } from "./shearFit";

function cornerMesh(): Mesh {
  const geometry = new BufferGeometry()
    .setAttribute("position", new Float32BufferAttribute([0.5, 0.25, 0, 0.6, 0.25, 0, 0.5, 0.35, 0.1], 3))
    .setIndex([0, 1, 2]);
  geometry.computeVertexNormals();
  return new Mesh(geometry, new MeshStandardMaterial());
}

describe("transforms that shear", () => {
  it("keeps a world point when a rotated mesh leaves a non-uniform parent", () => {
    const parent = new Object3D();
    parent.scale.set(2, 1, 1);
    const child = cornerMesh();
    child.rotation.z = Math.PI / 4;
    parent.add(child);
    parent.updateMatrixWorld(true);
    const editor = new EditorScene(new Scene(), "project");
    editor.importObject("parent", parent);
    editor.importObject("child", child);
    const before = meshVertexWorld(child, 0);
    expect(editor.execute("leave", editor.currentRevision, [{ commandId: "u", type: "scene.set_parent", objectId: "child", parentId: null }]).status).toBe("applied");
    const moved = editor.getObject("child");
    if (!moved) throw new Error("Missing child");
    expect(meshVertexWorld(moved, 0).distanceTo(before)).toBeLessThan(1e-4);
  });

  it("keeps a world point when parenting under a rotated non-uniform parent", () => {
    const parent = new Object3D();
    parent.rotation.z = Math.PI / 4;
    parent.scale.set(2, 1, 1);
    const child = cornerMesh();
    const editor = new EditorScene(new Scene(), "project");
    editor.importObject("parent", parent);
    editor.importObject("child", child);
    parent.updateMatrixWorld(true);
    const before = meshVertexWorld(child, 0);
    expect(editor.execute("join", editor.currentRevision, [{ commandId: "p", type: "scene.set_parent", objectId: "child", parentId: "parent" }]).status).toBe("applied");
    const moved = editor.getObject("child");
    if (!moved) throw new Error("Missing child");
    expect(meshVertexWorld(moved, 0).distanceTo(before)).toBeLessThan(1e-4);
  });

  it("turns a selection about its pivot without baking the parent's scale into a squash", () => {
    const parent = new Object3D();
    parent.scale.set(2, 1, 1);
    const child = cornerMesh();
    child.rotation.z = Math.PI / 4;
    child.position.set(1, 0, 0);
    parent.add(child);
    parent.updateMatrixWorld(true);
    const before = meshVertexWorld(child, 0);
    const pivot = new Object3D();
    child.getWorldPosition(pivot.position);
    pivot.updateMatrixWorld(true);
    const group = new GroupTransform();
    group.begin(pivot, [child]);
    pivot.rotateY(Math.PI / 2);
    group.update(pivot);
    const rigid = before.clone().sub(pivot.position).applyAxisAngle(new Vector3(0, 1, 0), Math.PI / 2).add(pivot.position);
    expect(meshVertexWorld(child, 0).distanceTo(rigid)).toBeLessThan(1e-4);
    group.commit();
    expect(meshVertexWorld(child, 0).distanceTo(rigid)).toBeLessThan(1e-4);
    group.end();
  });

  it("stores a world rotation under a non-uniform parent as an exact transform", () => {
    const parent = new Object3D();
    parent.scale.set(2, 1, 1);
    const child = new Object3D();
    parent.add(child);
    parent.updateMatrixWorld(true);
    const start = child.matrixWorld.clone();
    correctWorldRotation(child, start, new Vector3(0, 1, 0), Math.PI / 2);
    child.updateMatrixWorld(true);
    const world = child.localToWorld(new Vector3(0.5, 0, 0));
    expect(world.x).toBeCloseTo(0, 5);
    expect(world.y).toBeCloseTo(0, 5);
    expect(world.z).toBeCloseTo(-1, 5);
    expect(child.matrixAutoUpdate).toBe(true);
    const rebuilt = new Matrix4().compose(child.position, child.quaternion, child.scale);
    expect(new Vector3(0.5, 0, 0).applyMatrix4(rebuilt).applyMatrix4(parent.matrixWorld).z).toBeCloseTo(-1, 5);
  });
});

describe("baking a shear", () => {
  const shear = new Matrix4().set(1, 1, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
  const worldTangent = (mesh: Mesh, index: number) => {
    const tangent = mesh.geometry.getAttribute("tangent");
    mesh.updateMatrix();
    return new Vector3(tangent.getX(index), tangent.getY(index), tangent.getZ(index)).transformDirection(mesh.matrix);
  };

  it.each([[[1, 0, 0]], [[0, 1, 0]], [[1, 2, 3]]])("moves the tangent %j as the surface moves", (direction) => {
    const mesh = cornerMesh();
    const [x = 0, y = 0, z = 0] = direction;
    mesh.geometry.setAttribute("tangent", new Float32BufferAttribute([x, y, z, 1, x, y, z, 1, x, y, z, 1], 4));
    assignLocalMatrix(mesh, shear, true);
    const expected = new Vector3(x, y, z).transformDirection(shear);
    expect(worldTangent(mesh, 0).distanceTo(expected)).toBeLessThan(1e-5);
    expect(mesh.geometry.getAttribute("tangent").getW(0)).toBe(1);
  });
});
