import { beforeAll, describe, expect, it } from "vitest";
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Scene, Vector3, type BufferGeometry, type Object3D } from "three";
import { meshInspectionRequestSchema, type MeshStep } from "@movynta/editor-protocol";
import { EditorScene, type SceneStep } from "../assistant/EditorScene";
import { ensureManifold } from "./meshBoolean";

beforeAll(async () => {
  await ensureManifold();
});

function isMesh(object: Object3D | undefined): object is Mesh {
  return object instanceof Mesh;
}
function volumeOf(geometry: BufferGeometry): number {
  const position = geometry.getAttribute("position");
  const index = geometry.getIndex();
  const a = new Vector3(), b = new Vector3(), c = new Vector3();
  let signed = 0;
  const count = Math.floor((index ? index.count : position.count) / 3);
  for (let tri = 0; tri < count; tri += 1) {
    const base = tri * 3;
    a.fromBufferAttribute(position, index ? index.getX(base) : base);
    b.fromBufferAttribute(position, index ? index.getX(base + 1) : base + 1);
    c.fromBufferAttribute(position, index ? index.getX(base + 2) : base + 2);
    signed += a.dot(b.clone().cross(c));
  }
  return Math.abs(signed) / 6;
}

/** An imported model: a group of named box parts. Cutter overlaps one corner of a unit box at the origin. */
function robot(shared?: BoxGeometry): Group {
  const model = new Group();
  model.name = "robot.glb";
  for (const [name, at] of [["Head", [5, 0, 0]], ["Cutter", [0.5, 0.5, 0.5]], ["Arm", [9, 0, 0]]] as const) {
    const mesh = new Mesh(shared ?? new BoxGeometry(1, 1, 1), new MeshStandardMaterial());
    mesh.name = name;
    mesh.position.fromArray([...at]);
    model.add(mesh);
  }
  return model;
}

const IMPORT: SceneStep = { kind: "import", assetId: "asset", objectId: "model", name: "robot.glb", format: "glb" };
const prim = (id: string, extra: Record<string, unknown> = {}) => ({ commandId: `c_${id}`, type: "geometry.create_primitive", objectId: id, primitive: "box", size: 1, replaceExisting: false, ...extra });
const cut = (objectId: string, operandMeshPath: MeshStep[], target: MeshStep[] = []) => ({
  commandId: `cut_${objectId}`, type: "geometry.set_modifiers", objectId, meshPath: target,
  modifiers: [{ id: "cut", kind: "boolean", enabled: true, operation: "difference", operandObjectId: "model", operandMeshPath }],
});
const move = (objectId: string, x: number) => ({ commandId: `m_${objectId}_${String(x).replace(".", "p")}`, type: "scene.transform_object", objectId, transform: { position: [x, 0, 0] } });
const hat = [prim("hat"), { commandId: "under", type: "scene.set_parent", objectId: "hat", parentId: "model" }];

function scene(): { editor: EditorScene; run: (commands: unknown[]) => ReturnType<EditorScene["execute"]> } {
  const editor = new EditorScene(new Scene(), "p");
  editor.importObject("model", robot());
  const run = (commands: unknown[]) => editor.execute(`p${editor.currentRevision}`, editor.currentRevision, commands);
  expect(run([prim("box")]).status).toBe("applied");
  return { editor, run };
}
const meshOf = (editor: EditorScene, id: string): Mesh => {
  const object = editor.getObject(id);
  if (!isMesh(object)) throw new Error(`${id} is not a mesh`);
  return object;
};
const children = (editor: EditorScene) => (editor.getObject("model")?.children ?? []).map((child) => child.name);

describe("a batch that changes the scene while a Boolean uses a part of an imported model", () => {
  const withCut = () => {
    const made = scene();
    expect(made.run([cut("box", ["Cutter"])]).status).toBe("applied");
    expect(volumeOf(meshOf(made.editor, "box").geometry)).toBeCloseTo(0.875, 4);
    return made;
  };

  it("applies a re-parenting, which failed with 'Boolean operand does not exist' before", () => {
    const { editor, run } = withCut();
    expect(run([prim("other"), { commandId: "s", type: "scene.set_parent", objectId: "other", parentId: "box" }]).status).toBe("applied");
    expect(volumeOf(meshOf(editor, "box").geometry)).toBeCloseTo(0.875, 4);
  });

  it("applies a creation together with a transform, which also failed", () => {
    const { editor, run } = withCut();
    expect(run([prim("n1"), move("n1", 3)]).status).toBe("applied");
    expect(volumeOf(meshOf(editor, "box").geometry)).toBeCloseTo(0.875, 4);
  });

  it("puts an object under the model, and the cut still uses the right part", () => {
    const { editor, run } = withCut();
    expect(run(hat).status).toBe("applied");
    expect(children(editor).slice(1)).toEqual(["Head", "Cutter", "Arm"]);
    expect(volumeOf(meshOf(editor, "box").geometry)).toBeCloseTo(0.875, 4);
  });

  it("works out the cut again from where the model is after the batch, not where it was", () => {
    const { editor, run } = withCut();
    // The model moves away in a batch that also creates something, so the cut must be re-evaluated on the copies.
    expect(run([prim("n1"), { commandId: "away", type: "scene.transform_object", objectId: "model", transform: { position: [20, 0, 0] } }]).status).toBe("applied");
    expect(volumeOf(meshOf(editor, "box").geometry)).toBeCloseTo(1, 4);
    expect(run([prim("n2"), { commandId: "back", type: "scene.transform_object", objectId: "model", transform: { position: [0, 0, 0] } }]).status).toBe("applied");
    expect(volumeOf(meshOf(editor, "box").geometry)).toBeCloseTo(0.875, 4);
  });

  it("leaves the model's parts attached, in the same order, and the scene as it was, when the batch fails", () => {
    const { editor, run } = withCut();
    run([prim("a"), { commandId: "s", type: "scene.set_parent", objectId: "a", parentId: "model" }]);
    const model = editor.getObject("model");
    const before = [...(model?.children ?? [])];
    const revision = editor.currentRevision;
    // Scaling the cut box to nothing makes the Boolean impossible, which is only found when it is evaluated on the copies.
    const result = run([prim("z"), { commandId: "flat", type: "scene.transform_object", objectId: "box", transform: { scale: [0, 1, 1] } }]);
    expect(result.status).toBe("failed");
    expect(editor.currentRevision).toBe(revision);
    expect([...(model?.children ?? [])]).toEqual(before);
    for (const child of model?.children ?? []) expect(child.parent).toBe(model);
    expect(editor.getObject("z")).toBeUndefined();
    // The scene still works afterwards.
    expect(run([prim("after"), move("after", 3)]).status).toBe("applied");
    expect(volumeOf(meshOf(editor, "box").geometry)).toBeCloseTo(0.875, 4);
  });

  it("works through the prepared edit the interface and the assistant use", () => {
    const { editor } = withCut();
    const commands = hat;
    const prepared = editor.executePrepared("prep", editor.currentRevision, commands, "prepare");
    expect(prepared.status).toBe("applied");
    editor.executePrepared("prep", editor.currentRevision, commands, "commit");
    expect(children(editor).slice(1)).toEqual(["Head", "Cutter", "Arm"]);
    expect(volumeOf(meshOf(editor, "box").geometry)).toBeCloseTo(0.875, 4);
  });

  it("replays from the saved steps", async () => {
    const steps: SceneStep[] = [
      IMPORT,
      { kind: "commands", proposalId: "box", commands: [prim("box")] },
      { kind: "commands", proposalId: "cut", commands: [cut("box", ["Cutter"])] },
      { kind: "commands", proposalId: "hat", commands: hat },
    ];
    const replay = new EditorScene(new Scene(), "p");
    await replay.restore(steps, () => Promise.resolve(robot()));
    expect(volumeOf(meshOf(replay, "box").geometry)).toBeCloseTo(0.875, 4);
  });
});

describe("a part of the model that is itself cut by a scene object", () => {
  it("is cut again when a batch that also creates something moves the cutter", () => {
    const editor = new EditorScene(new Scene(), "p");
    editor.importObject("model", robot());
    const run = (commands: unknown[]) => editor.execute(`p${editor.currentRevision}`, editor.currentRevision, commands);
    // A unit box at the Arm's corner cuts the Arm part, which is inside the imported model.
    expect(run([prim("cutter", { transform: { position: [9.5, 0.5, 0.5] } })]).status).toBe("applied");
    const armCut = { commandId: "armcut", type: "geometry.set_modifiers", objectId: "model", meshPath: ["Arm"], modifiers: [{ id: "cut", kind: "boolean", enabled: true, operation: "difference", operandObjectId: "cutter", operandMeshPath: [] }] };
    expect(run([armCut]).status).toBe("applied");
    const arm = () => {
      const part = editor.getObject("model")?.children.find((child) => child.name === "Arm");
      if (!isMesh(part)) throw new Error("no arm");
      return part;
    };
    expect(volumeOf(arm().geometry)).toBeCloseTo(0.875, 4);
    expect(run([prim("n1"), { commandId: "away", type: "scene.transform_object", objectId: "cutter", transform: { position: [30, 0, 0] } }]).status).toBe("applied");
    expect(volumeOf(arm().geometry)).toBeCloseTo(1, 4);
  });

  it("does not lose a geometry that other parts of the model share, when it is replaced by the cut", () => {
    const shared = new BoxGeometry(1, 1, 1);
    let disposed = false;
    shared.addEventListener("dispose", () => { disposed = true; });
    const editor = new EditorScene(new Scene(), "p");
    editor.importObject("model", robot(shared));
    const run = (commands: unknown[]) => editor.execute(`p${editor.currentRevision}`, editor.currentRevision, commands);
    run([prim("cutter", { transform: { position: [9.5, 0.5, 0.5] } })]);
    run([{ commandId: "armcut", type: "geometry.set_modifiers", objectId: "model", meshPath: ["Arm"], modifiers: [{ id: "cut", kind: "boolean", enabled: true, operation: "difference", operandObjectId: "cutter", operandMeshPath: [] }] }]);
    disposed = false;
    expect(run([prim("n1"), { commandId: "away", type: "scene.transform_object", objectId: "cutter", transform: { position: [30, 0, 0] } }]).status).toBe("applied");
    // Head and Cutter still use the shared geometry, so it must not have been freed.
    expect(disposed).toBe(false);
  });
});

describe("a Boolean that names its operand by index", () => {
  it("keeps cutting with the same part when a child that came before the parts is deleted", () => {
    const { editor, run } = scene();
    run(hat);
    // Written the old way, by index: with the hat in front, the cutter is at index 2.
    expect(run([cut("box", [2])]).status).toBe("applied");
    expect(volumeOf(meshOf(editor, "box").geometry)).toBeCloseTo(0.875, 4);
    // Deleting the hat moves every part down by one. Index 2 would now be the arm, far away.
    expect(run([{ commandId: "d", type: "scene.delete_object", objectId: "hat" }]).status).toBe("applied");
    expect(children(editor)).toEqual(["Head", "Cutter", "Arm"]);
    // Moving the box makes the cut be worked out again from the stored path.
    expect(run([move("box", 0.0001)]).status).toBe("applied");
    expect(volumeOf(meshOf(editor, "box").geometry)).toBeCloseTo(0.875, 3);
  });

  it("is stored by name, so the part is still the cutter in the inspection", () => {
    const { editor, run } = scene();
    run([cut("box", [1])]);
    const inspection = editor.context(meshInspectionRequestSchema.parse({ objectId: "box", includeSamples: false })).meshInspection;
    const stored = inspection?.modifiers?.[0];
    expect(stored && stored.kind === "boolean" ? stored.operandMeshPath : undefined).toEqual(["Cutter"]);
  });

  it("is left as an index for a part that has no name", () => {
    const editor = new EditorScene(new Scene(), "p");
    const model = new Group();
    const plain = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial());
    plain.position.set(0.5, 0.5, 0.5);
    model.add(plain);
    editor.importObject("model", model);
    expect(editor.execute("a", editor.currentRevision, [prim("box")]).status).toBe("applied");
    expect(editor.execute("b", editor.currentRevision, [cut("box", [0])]).status).toBe("applied");
    const stored = editor.context(meshInspectionRequestSchema.parse({ objectId: "box", includeSamples: false })).meshInspection?.modifiers?.[0];
    expect(stored && stored.kind === "boolean" ? stored.operandMeshPath : undefined).toEqual([0]);
  });
});
