import { beforeAll, describe, expect, it } from "vitest";
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Scene, Vector3, type BufferGeometry } from "three";
import { meshInspectionRequestSchema, type MeshStep } from "@movynta/editor-protocol";
import { EditorScene, type SceneStep } from "../assistant/EditorScene";
import { ensureManifold } from "./meshBoolean";
import { isMesh } from "@/lib/three";

beforeAll(async () => {
  await ensureManifold();
});


/** The volume of a closed mesh, from its triangles. */
function volumeOf(geometry: BufferGeometry): number {
  const position = geometry.getAttribute("position");
  const index = geometry.getIndex();
  const a = new Vector3(), b = new Vector3(), c = new Vector3();
  let signed = 0;
  const triangles = Math.floor((index ? index.count : position.count) / 3);
  for (let tri = 0; tri < triangles; tri += 1) {
    const base = tri * 3;
    a.fromBufferAttribute(position, index ? index.getX(base) : base);
    b.fromBufferAttribute(position, index ? index.getX(base + 1) : base + 1);
    c.fromBufferAttribute(position, index ? index.getX(base + 2) : base + 2);
    signed += a.dot(b.clone().cross(c));
  }
  return Math.abs(signed) / 6;
}

/** An imported model: a group of named box parts, as a loader would make. Cutter overlaps a corner of a unit box at the origin. */
function robot(): Group {
  const model = new Group();
  model.name = "robot.glb";
  for (const [name, at] of [["Head", [5, 0, 0]], ["Cutter", [0.5, 0.5, 0.5]], ["Arm", [9, 0, 0]]] as const) {
    const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial());
    mesh.name = name;
    mesh.position.fromArray([...at]);
    model.add(mesh);
  }
  return model;
}

const IMPORT: SceneStep = { kind: "import", assetId: "asset", objectId: "model", name: "robot.glb", format: "glb" };
const box = (id: string) => ({ commandId: `c_${id}`, type: "geometry.create_primitive", objectId: id, primitive: "box", size: 1, replaceExisting: false });
const cut = (objectId: string, operandMeshPath: MeshStep[]) => ({
  commandId: `cut_${objectId}`, type: "geometry.set_modifiers", objectId,
  modifiers: [{ id: "cut", kind: "boolean", enabled: true, operation: "difference", operandObjectId: "model", operandMeshPath }],
});
const hat = [
  { commandId: "hat", type: "geometry.create_primitive", objectId: "hat", primitive: "box", size: 1, replaceExisting: false },
  { commandId: "under", type: "scene.set_parent", objectId: "hat", parentId: "model" },
];

function meshOf(editor: EditorScene, id: string): Mesh {
  const object = editor.getObject(id);
  if (!isMesh(object)) throw new Error(`${id} is not a mesh`);
  return object;
}
const subdivide = (editor: EditorScene, path: MeshStep[]) =>
  editor.execute(`sub-${path.join("-")}`, editor.currentRevision, [{ commandId: "s", type: "geometry.subdivide", objectId: "model", meshPath: path, levels: 1, method: "linear" }]);
function trianglesOf(editor: EditorScene, name: string): number {
  const found = editor.getObject("model")?.children.find((child) => child.name === name);
  return isMesh(found) ? (found.geometry.index?.count ?? found.geometry.getAttribute("position").count) / 3 : 0;
}
function partNames(editor: EditorScene): string[] {
  return (editor.getObject("model")?.children ?? []).map((child) => child.name);
}

/** The scene with a robot imported and two unit boxes. */
function scene(): EditorScene {
  const editor = new EditorScene(new Scene(), "p");
  editor.importObject("model", robot());
  expect(editor.execute("boxes", editor.currentRevision, [box("byName"), box("byIndex")]).status).toBe("applied");
  return editor;
}
const applyCut = (editor: EditorScene, objectId: string, path: MeshStep[]) => editor.execute(`cut-${objectId}`, editor.currentRevision, [cut(objectId, path)]);

describe("a part named by an index points at whatever is at that position", () => {
  it("moves when a scene object is put under the imported model, which the part's name does not", () => {
    const editor = scene();
    expect(partNames(editor)).toEqual(["Head", "Cutter", "Arm"]);
    // Before: index 1 is the cutter.
    expect(editor.execute("hat", editor.currentRevision, hat).status).toBe("applied");
    // The new object went in front of the parts, so every index moved up by one.
    expect(partNames(editor)[0]).toMatch(/^box/);
    expect(partNames(editor).slice(1)).toEqual(["Head", "Cutter", "Arm"]);

    // The same two references to "the cutter", written before the move, are used now.
    expect(applyCut(editor, "byName", ["Cutter"]).status).toBe("applied");
    expect(applyCut(editor, "byIndex", [1]).status).toBe("applied");
    // By name it finds the cutter and cuts the corner out. By index it finds the head, far away, and cuts nothing.
    expect(volumeOf(meshOf(editor, "byName").geometry)).toBeCloseTo(0.875, 4);
    expect(volumeOf(meshOf(editor, "byIndex").geometry)).toBeCloseTo(1, 4);
  });

  it("still means what it meant for a path stored as indexes, while the parts have not moved", () => {
    const editor = scene();
    expect(applyCut(editor, "byIndex", [1]).status).toBe("applied");
    expect(volumeOf(meshOf(editor, "byIndex").geometry)).toBeCloseTo(0.875, 4);
  });

  it("finds the same mesh by name and by index when they lead to the same part", () => {
    const editor = scene();
    applyCut(editor, "byName", ["Cutter"]);
    applyCut(editor, "byIndex", [1]);
    expect(volumeOf(meshOf(editor, "byName").geometry)).toBeCloseTo(volumeOf(meshOf(editor, "byIndex").geometry), 6);
  });
});

describe("inspecting an imported model", () => {
  it("gives each part's path by name, and a path by index where a part has no name", () => {
    const editor = new EditorScene(new Scene(), "p");
    const model = robot();
    const unnamed = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial());
    model.add(unnamed);
    const twin = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial());
    twin.name = "Arm";
    model.add(twin);
    editor.importObject("model", model);
    const inspection = editor.context(meshInspectionRequestSchema.parse({ objectId: "model" })).meshInspection;
    expect(inspection?.parts.map((entry) => entry.path)).toEqual([["Head"], ["Cutter"], ["Arm"], [3], ["Arm#1"]]);
  });

  it("gives paths that lead back to the part they came with, and that a command can use", () => {
    const editor = scene();
    const inspection = editor.context(meshInspectionRequestSchema.parse({ objectId: "model" })).meshInspection;
    const arm = inspection?.parts.find((entry) => entry.name === "Arm");
    expect(arm?.path).toEqual(["Arm"]);
    expect(subdivide(editor, arm?.path ?? []).status).toBe("applied");
    expect(trianglesOf(editor, "Arm")).toBeGreaterThan(12);
    expect(trianglesOf(editor, "Head")).toBe(12);
  });

  it("still addresses the same part after a scene object is put under the model, where an index would not", () => {
    const editor = scene();
    editor.execute("hat", editor.currentRevision, hat);
    // Index 2 was the arm before the hat went in; now it is the cutter. The name is still the arm.
    expect(subdivide(editor, ["Arm"]).status).toBe("applied");
    expect(trianglesOf(editor, "Arm")).toBeGreaterThan(12);
    expect(trianglesOf(editor, "Cutter")).toBe(12);
  });

  it("refuses a name that no part has, and says to inspect again", () => {
    const editor = scene();
    const result = subdivide(editor, ["Leg"]);
    expect(result.status).toBe("failed");
    expect(JSON.stringify(result)).toContain("choose a meshPath from its parts");
  });
});

describe("the picked part in the context", () => {
  it("is reported by name even though the interface picks it by index", () => {
    const editor = scene();
    editor.setDesignFocus({ mode: "edit", componentKind: "face", componentSelection: { objectId: "model", meshPath: [2], kind: "face", ids: ["0"], modifiersEnabled: false } });
    expect(editor.context().designFocus?.componentSelection?.meshPath).toEqual(["Arm"]);
  });

  it("is left as indexes for a part with no name", () => {
    const editor = new EditorScene(new Scene(), "p");
    const model = new Group();
    const plain = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial());
    model.add(plain);
    editor.importObject("model", model);
    editor.setDesignFocus({ mode: "edit", componentKind: "face", componentSelection: { objectId: "model", meshPath: [0], kind: "face", ids: ["0"], modifiersEnabled: false } });
    expect(editor.context().designFocus?.componentSelection?.meshPath).toEqual([0]);
  });
});

describe("replaying a project that refers to a part by name", () => {
  it("finds the same part again, also when the model has a scene object under it", async () => {
    const steps: SceneStep[] = [
      IMPORT,
      { kind: "commands", proposalId: "hat", commands: hat },
      { kind: "commands", proposalId: "boxes", commands: [box("byName")] },
      { kind: "commands", proposalId: "cut", commands: [cut("byName", ["Cutter"])] },
    ];
    const live = new EditorScene(new Scene(), "p");
    await live.restore(steps, () => Promise.resolve(robot()));
    const replay = new EditorScene(new Scene(), "p");
    await replay.restore(steps, () => Promise.resolve(robot()));
    expect(partNames(replay)).toEqual(["box", "Head", "Cutter", "Arm"]);
    expect(volumeOf(meshOf(replay, "byName").geometry)).toBeCloseTo(0.875, 4);
    expect(volumeOf(meshOf(replay, "byName").geometry)).toBeCloseTo(volumeOf(meshOf(live, "byName").geometry), 9);
  });
});
