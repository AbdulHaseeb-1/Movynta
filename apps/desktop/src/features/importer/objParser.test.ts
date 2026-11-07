import { describe, expect, it } from "vitest";
import { Box3, type Mesh, MeshStandardMaterial, Vector3, type Object3D } from "three";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { parseObj } from "./objParser";
import { isMesh } from "@/lib/three";

const material = new MeshStandardMaterial();


function meshesOf(root: Object3D): Mesh[] {
  const meshes: Mesh[] = [];
  root.traverse((node) => {
    if (isMesh(node)) meshes.push(node);
  });
  return meshes;
}

/** The first mesh, failing the test with a clear message when there is none. */
function firstOf(meshes: readonly Mesh[]): Mesh {
  const [first] = meshes;
  if (!first) throw new Error("Expected at least one mesh");
  return first;
}

function positionsOf(mesh: Mesh): number[] {
  return Array.from(mesh.geometry.getAttribute("position").array);
}

/** A cube made of quads, with normals and texture coordinates, then a triangle written with negative indices. */
const SAMPLE = [
  "# a comment",
  "mtllib ignored.mtl",
  "o cube",
  "v -1 -1 1",
  "v 1 -1 1",
  "v 1 1 1",
  "v -1 1 1",
  "v -1 -1 -1",
  "v 1 -1 -1",
  "v 1 1 -1",
  "v -1 1 -1",
  "vt 0 0",
  "vt 1 0",
  "vt 1 1",
  "vt 0 1",
  "vn 0 0 1",
  "vn 0 0 -1",
  "usemtl wood",
  "s off",
  "f 1/1/1 2/2/1 3/3/1 4/4/1",
  "f 8/3/2 7/2/2 6/1/2 5/4/2",
  "o triangle",
  "v 5 0 0",
  "v 6 0 0",
  "v 5 1 0",
  "f -3 -2 -1",
  "",
].join("\n");

describe("parseObj", () => {
  it("reads the same geometry as the general loader", () => {
    const ours = meshesOf(parseObj(SAMPLE, material));
    const reference = meshesOf(new OBJLoader().parse(SAMPLE));
    expect(ours.map((mesh) => mesh.name)).toEqual(reference.map((mesh) => mesh.name));
    ours.forEach((mesh, index) => {
      const other = reference[index];
      if (!other) throw new Error("the reference has fewer objects");
      expect(positionsOf(mesh)).toEqual(positionsOf(other));
      expect(Array.from(mesh.geometry.getAttribute("normal").array)).toEqual(
        Array.from(other.geometry.getAttribute("normal").array),
      );
    });
    expect(positionsOf(firstOf(ours))).toHaveLength(2 * 2 * 3 * 3);
    expect(firstOf(ours).geometry.getAttribute("uv").count).toBe(12);
  });

  it("splits a quad into two triangles and a polygon into a fan", () => {
    const polygon = "v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0.5 1.5 0\nv 0 1 0\nf 1 2 3 4 5\n";
    const mesh = firstOf(meshesOf(parseObj(polygon, material)));
    expect(mesh.geometry.getAttribute("position").count).toBe(9);
  });

  it("computes normals when the file has none, and drops texture coordinates it cannot use", () => {
    const mesh = firstOf(meshesOf(parseObj("v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n", material)));
    expect(mesh.geometry.getAttribute("normal").getZ(0)).toBeCloseTo(1);
    expect(mesh.geometry.getAttribute("uv")).toBeUndefined();
  });

  it("copes with Windows line endings, tabs, odd spacing and a missing final newline", () => {
    const text = "v 0 0 0\r\nv\t1 0 0\r\n  v 0 1 0\r\nf   1  2\t3";
    const mesh = firstOf(meshesOf(parseObj(text, material)));
    expect(positionsOf(mesh)).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  });

  it("skips faces that point at vertices that do not exist, instead of failing the whole file", () => {
    const text = "v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\nf 1 2 9\nf 0 1 2\nf a b c\n";
    const mesh = firstOf(meshesOf(parseObj(text, material)));
    expect(mesh.geometry.getAttribute("position").count).toBe(3);
  });

  it("returns an empty group for a file with no faces", () => {
    expect(meshesOf(parseObj("# nothing here\nv 0 0 0\n", material))).toHaveLength(0);
    expect(meshesOf(parseObj("", material))).toHaveLength(0);
  });

  it("fits around the same space as the general loader", () => {
    const size = (root: Object3D) => new Box3().setFromObject(root).getSize(new Vector3()).toArray();
    expect(size(parseObj(SAMPLE, material))).toEqual(size(new OBJLoader().parse(SAMPLE)));
  });
});
