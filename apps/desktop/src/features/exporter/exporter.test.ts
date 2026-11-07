import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Box3, BoxGeometry, Group, Mesh, MeshStandardMaterial, Scene, Vector3, type Object3D } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { isMesh } from "@/lib/three";
import { EditorScene } from "../assistant/EditorScene";
import {
  copySelectionForExport,
  exportFileName,
  exportSelectionAsGlb,
  GLB_MIME_TYPE,
  metersPerSceneUnit,
  topLevelSelection,
} from "./exportSelection";

/** The exporter reads its output through FileReader, which the test environment does not provide. */
class BlobReader {
  result: ArrayBuffer | null = null;
  onloadend: (() => void) | null = null;

  readAsArrayBuffer(blob: Blob) {
    void blob.arrayBuffer().then((buffer) => {
      this.result = buffer;
      this.onloadend?.();
    });
  }
}

beforeAll(() => {
  vi.stubGlobal("FileReader", BlobReader);
});
afterAll(() => {
  vi.unstubAllGlobals();
});

function box(name: string, at: [number, number, number] = [0, 0, 0], size = 1): Mesh {
  const mesh = new Mesh(new BoxGeometry(size, size, size), new MeshStandardMaterial({ color: "#cc0000" }));
  mesh.name = name;
  mesh.position.set(...at);
  return mesh;
}

function groupNamed(name: string, at: [number, number, number] = [0, 0, 0]): Group {
  const group = new Group();
  group.name = name;
  group.position.set(...at);
  return group;
}

/** A workspace with the given objects registered under their ids, the first ones at the top level. */
function workspace(entries: readonly (readonly [string, Object3D])[], calibrated?: number) {
  const editor = new EditorScene(new Scene(), "prj_1");
  for (const [id, object] of entries) editor.importObject(id, object);
  if (calibrated !== undefined) editor.setMeasurementUnits({ display: "m", metersPerSceneUnit: calibrated });
  return editor;
}

/** Reads a .glb back the way Blender's importer receives it: nodes with their own names and transforms. */
async function readBack(blob: Blob): Promise<Group> {
  const gltf = await new GLTFLoader().parseAsync(await blob.arrayBuffer(), "");
  gltf.scene.updateMatrixWorld(true);
  return gltf.scene;
}

function nodeNamed(root: Object3D, name: string): Object3D {
  const found = root.getObjectByName(name);
  if (!found) throw new Error(`No node named ${name}`);
  return found;
}

/** Two boxes match to within float32 rounding, which is what a .glb stores its positions in. */
function expectSameBox(actual: Box3, expected: Box3): void {
  expect(actual.min.distanceTo(expected.min)).toBeLessThan(1e-5);
  expect(actual.max.distanceTo(expected.max)).toBeLessThan(1e-5);
}

/**
 * Triangles whose front points into the mesh, judged from their corners as they stand in the world. This is the
 * orientation Blender draws with, so a mirror whose faces were not turned around shows up here.
 */
function inwardFaces(object: Object3D): number {
  if (!isMesh(object)) throw new Error(`${object.name} is not a mesh`);
  object.updateMatrixWorld(true);
  const position = object.geometry.getAttribute("position");
  const index = object.geometry.getIndex();
  const corners = Array.from({ length: position.count }, (_, vertex) =>
    new Vector3().fromBufferAttribute(position, vertex).applyMatrix4(object.matrixWorld),
  );
  const center = corners.reduce((sum, corner) => sum.add(corner), new Vector3()).divideScalar(corners.length);
  const vertexOf = (at: number) => (index ? index.getX(at) : at);
  let inward = 0;
  for (let first = 0; first + 2 < (index?.count ?? position.count); first += 3) {
    const a = corners[vertexOf(first)];
    const b = corners[vertexOf(first + 1)];
    const c = corners[vertexOf(first + 2)];
    if (!a || !b || !c) continue;
    const normal = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a));
    const middle = new Vector3().add(a).add(b).add(c).divideScalar(3);
    if (normal.dot(middle.sub(center)) < 0) inward += 1;
  }
  return inward;
}

describe("choosing what to export", () => {
  it("leaves out an object that sits inside another selected object", () => {
    const rig = groupNamed("rig");
    const arm = box("arm");
    rig.add(arm);
    const editor = workspace([["rig", rig], ["arm", arm]]);
    const objects = [editor.getObject("arm"), editor.getObject("rig")].flatMap((object) => object ?? []);
    expect(topLevelSelection(objects).map((object) => object.name)).toEqual(["rig"]);
  });

  it("leaves out an object that is hidden, or that sits inside a hidden object", () => {
    const rig = groupNamed("rig");
    const arm = box("arm");
    rig.add(arm);
    const lamp = box("lamp");
    lamp.visible = false;
    workspace([["rig", rig], ["lamp", lamp]]);
    rig.visible = false;
    expect(topLevelSelection([arm])).toEqual([]);
    expect(topLevelSelection([lamp])).toEqual([]);
    rig.visible = true;
    expect(topLevelSelection([arm, rig]).map((object) => object.name)).toEqual(["rig"]);
  });

  it("refuses to export when nothing selected is visible", () => {
    const lamp = box("lamp");
    lamp.visible = false;
    const editor = workspace([["lamp", lamp]]);
    editor.selectMany(["lamp"]);
    expect(() => copySelectionForExport(editor)).toThrow("Select a visible object to export it.");
  });
});

describe("placement in Blender", () => {
  it("writes each object where it is in the workspace, even when its parent is not exported", async () => {
    const rig = groupNamed("rig", [0, 2, 0]);
    const arm = box("arm", [1, 0, 0]);
    rig.add(arm);
    const editor = workspace([["rig", rig], ["arm", arm]]);
    editor.selectMany(["arm"]);
    const scene = await readBack((await exportSelectionAsGlb(editor)).blob);
    const exported = nodeNamed(scene, "arm");
    expect(exported.getWorldPosition(new Vector3()).toArray()).toEqual([1, 2, 0]);
    expect(scene.children.map((child) => child.name)).toEqual(["arm"]);
  });

  it("keeps children with their parent, relative to it", async () => {
    const rig = groupNamed("rig", [0, 2, 0]);
    const arm = box("arm", [1, 0, 0]);
    rig.add(arm);
    const editor = workspace([["rig", rig], ["arm", arm]]);
    editor.selectMany(["rig"]);
    const scene = await readBack((await exportSelectionAsGlb(editor)).blob);
    expect(scene.children.map((child) => child.name)).toEqual(["rig"]);
    expect(nodeNamed(scene, "rig").position.toArray()).toEqual([0, 2, 0]);
    expect(nodeNamed(scene, "arm").position.toArray()).toEqual([1, 0, 0]);
    expect(nodeNamed(scene, "arm").getWorldPosition(new Vector3()).toArray()).toEqual([1, 2, 0]);
  });

  it("writes positions in meters when the project is calibrated", async () => {
    const crate = box("crate", [4, 3, 0], 1);
    const editor = workspace([["crate", crate]], 0.5);
    editor.selectMany(["crate"]);
    const scene = await readBack((await exportSelectionAsGlb(editor)).blob);
    const node = nodeNamed(scene, "crate");
    expect(node.getWorldPosition(new Vector3()).toArray()).toEqual([2, 1.5, 0]);
    expect(new Box3().setFromObject(node).getSize(new Vector3()).x).toBeCloseTo(0.5);
  });

  it("places a mirrored object exactly where the workspace shows it", async () => {
    const wing = box("wing", [5, 0, 0]);
    wing.scale.x = -1;
    wing.rotation.y = 0.5;
    const editor = workspace([["wing", wing]]);
    editor.selectMany(["wing"]);
    const scene = await readBack((await exportSelectionAsGlb(editor)).blob);
    const node = nodeNamed(scene, "wing");
    expectSameBox(new Box3().setFromObject(node), new Box3().setFromObject(wing));
    expect(node.matrixWorld.determinant()).toBeGreaterThan(0);
  });

  it("keeps a mirrored object's faces facing outward, which Blender needs to draw it", async () => {
    const wing = box("wing", [5, 0, 0]);
    wing.scale.x = -1;
    const editor = workspace([["wing", wing]]);
    editor.selectMany(["wing"]);
    const scene = await readBack((await exportSelectionAsGlb(editor)).blob);
    expect(inwardFaces(nodeNamed(scene, "wing"))).toBe(0);
  });

  it("places every part under a mirrored group, at any depth, where the workspace has it", async () => {
    const mirror = groupNamed("mirror", [3, 0, 0]);
    mirror.scale.x = -1;
    const left = box("left", [1, 0, 0], 0.5);
    left.rotation.z = 0.3;
    const deep = box("deep", [0, 1, 0], 0.25);
    left.add(deep);
    mirror.add(left);
    const editor = workspace([["mirror", mirror], ["left", left], ["deep", deep]]);
    editor.selectMany(["mirror"]);
    const scene = await readBack((await exportSelectionAsGlb(editor)).blob);
    mirror.updateMatrixWorld(true);
    for (const name of ["mirror", "left", "deep"]) {
      const node = nodeNamed(scene, name);
      const original = editor.getObject(name);
      expect(original).toBeDefined();
      if (!original) continue;
      expectSameBox(new Box3().setFromObject(node), new Box3().setFromObject(original));
      if (node instanceof Mesh) expect(inwardFaces(node)).toBe(0);
    }
    expect(nodeNamed(scene, "deep").parent?.name).toBe("left");
    expect(nodeNamed(scene, "left").parent?.name).toBe("mirror");
  });

  it("keeps the hierarchy of a child that is mirrored", async () => {
    const rig = groupNamed("rig", [0, 2, 0]);
    const arm = box("arm", [1, 0, 0]);
    arm.scale.x = -1;
    rig.add(arm);
    const editor = workspace([["rig", rig], ["arm", arm]]);
    editor.selectMany(["rig"]);
    const scene = await readBack((await exportSelectionAsGlb(editor)).blob);
    const node = nodeNamed(scene, "arm");
    expect(node.parent?.name).toBe("rig");
    expect(node.getWorldPosition(new Vector3()).toArray()).toEqual([1, 2, 0]);
    expect(node.matrixWorld.determinant()).toBeGreaterThan(0);
    expect(inwardFaces(node)).toBe(0);
    expectSameBox(new Box3().setFromObject(node), new Box3().setFromObject(arm));
  });

  it("uses one meter per scene unit when the scene is unitless", () => {
    expect(metersPerSceneUnit(null)).toBe(1);
    expect(metersPerSceneUnit({ display: "cm", metersPerSceneUnit: 0.01 })).toBe(0.01);
  });
});

describe("what is written", () => {
  it("writes a binary glTF file with the object's name and material", async () => {
    const arm = box("arm");
    const editor = workspace([["arm", arm]]);
    editor.selectMany(["arm"]);
    const { blob, fileName } = await exportSelectionAsGlb(editor);
    expect(blob.type).toBe(GLB_MIME_TYPE);
    expect(new TextDecoder().decode(new Uint8Array(await blob.slice(0, 4).arrayBuffer()))).toBe("glTF");
    expect(fileName).toBe("arm.glb");
    const node = nodeNamed(await readBack(blob), "arm");
    expect(node).toBeInstanceOf(Mesh);
    expect(node instanceof Mesh && node.material instanceof MeshStandardMaterial).toBe(true);
  });

  it("leaves out hidden children of an exported object", async () => {
    const rig = groupNamed("rig");
    const arm = box("arm");
    const spare = box("spare");
    spare.visible = false;
    rig.add(arm, spare);
    const editor = workspace([["rig", rig]]);
    editor.selectMany(["rig"]);
    const scene = await readBack((await exportSelectionAsGlb(editor)).blob);
    expect(scene.getObjectByName("arm")).toBeDefined();
    expect(scene.getObjectByName("spare")).toBeUndefined();
  });

  it("writes several objects into one file, in the order they were chosen", async () => {
    const editor = workspace([["a", box("a")], ["b", box("b", [2, 0, 0])]]);
    editor.selectMany(["b", "a"]);
    const exported = await exportSelectionAsGlb(editor);
    expect(exported.fileName).toBe("selection.glb");
    const scene = await readBack(exported.blob);
    expect(scene.children.map((child) => child.name)).toEqual(["b", "a"]);
  });

  it("holds the selection as it was when the export began", async () => {
    const crate = box("crate", [1, 0, 0]);
    const editor = workspace([["crate", crate]]);
    editor.selectMany(["crate"]);
    const pending = exportSelectionAsGlb(editor);
    crate.position.set(9, 0, 0);
    const scene = await readBack((await pending).blob);
    expect(nodeNamed(scene, "crate").position.toArray()).toEqual([1, 0, 0]);
  });

  it("leaves the workspace unchanged", async () => {
    const rig = groupNamed("rig", [0, 2, 0]);
    const arm = box("arm", [1, 0, 0]);
    arm.userData = { kept: true };
    rig.add(arm);
    const editor = workspace([["rig", rig], ["arm", arm]]);
    editor.selectMany(["rig"]);
    rig.updateMatrixWorld(true);
    const before = arm.matrixWorld.clone();
    await exportSelectionAsGlb(editor);
    expect(arm.matrixWorld.equals(before)).toBe(true);
    expect(rig.position.toArray()).toEqual([0, 2, 0]);
    expect(rig.children).toContain(arm);
    expect(arm.userData).toEqual({ kept: true });
  });
});

describe("file names", () => {
  it("names one object after itself, without a model extension", () => {
    expect(exportFileName(["robot.glb"])).toBe("robot.glb");
    expect(exportFileName(["Robot v2.obj"])).toBe("Robot v2.glb");
  });

  it("names several objects selection.glb", () => {
    expect(exportFileName(["a", "b"])).toBe("selection.glb");
  });

  it("replaces characters that file systems reject", () => {
    expect(exportFileName(["bad/name:here?"])).toBe("bad_name_here_.glb");
    expect(exportFileName([""])).toBe("selection.glb");
  });
});
