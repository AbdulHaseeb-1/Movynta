import { describe, expect, it, vi } from "vitest";
import { PerspectiveCamera, Scene, Vector2, Vector3 } from "three";
import { pickObjectId } from "@/features/objectEditing/picking";
import { EditorScene, type ImportedModelStep, type ObjectTransform } from "@/features/assistant/EditorScene";
import { BoneSelection } from "./BoneSelection";
import { poseCommand } from "./poseCommands";
import { boneAt, isSkinnedMesh, poseOf, rigOf } from "./rig";
import { buildRiggedModel } from "./rigFixture";

const TURNED: ObjectTransform = { position: [0, 0.5, 0], rotation: [0, 0, 0.7], scale: [1, 1, 1] };

function sceneWithRig(projectId = "prj_1") {
  const scene = new Scene();
  const editor = new EditorScene(scene, projectId);
  const model = buildRiggedModel(5);
  editor.importObject("robot", model);
  return { scene, editor, model };
}

function boneOf(editor: EditorScene, objectId: string, index: number) {
  const object = editor.getObject(objectId);
  const rig = object ? rigOf(object) : undefined;
  return rig ? boneAt(rig, index) : undefined;
}

describe("posing a bone through the scene", () => {
  it("sets the bone's transform, moves the scene to a new revision and tells the listeners", () => {
    const { editor } = sceneWithRig();
    let notified = 0;
    editor.onChange(() => (notified += 1));
    const revision = editor.currentRevision;

    const edit = editor.applyUserPose("robot", 2, TURNED);
    expect(edit.applied).toBe(true);
    expect(edit.commands).toHaveLength(1);
    const bone = boneOf(editor, "robot", 2);
    expect(bone?.rotation.z).toBeCloseTo(0.7);
    expect(editor.currentRevision).toBe(revision + 1);
    expect(notified).toBe(1);
  });

  it("changes only the parts of the transform that are given", () => {
    const { editor } = sceneWithRig();
    const before = boneOf(editor, "robot", 1);
    const start = before ? poseOf(before) : undefined;
    const result = editor.execute("pose-1", editor.currentRevision, [
      { commandId: "p", type: "rig.pose_bone", objectId: "robot", bone: 1, transform: { rotation: [0.2, 0, 0] } },
    ]);
    expect(result.status).toBe("applied");
    const bone = boneOf(editor, "robot", 1);
    expect(bone?.rotation.x).toBeCloseTo(0.2);
    expect(bone?.position.toArray()).toEqual(start?.position);
  });

  it("rolls back the whole batch when one bone does not exist, naming the bone", () => {
    const { editor } = sceneWithRig();
    const revision = editor.currentRevision;
    const result = editor.execute("bad", revision, [
      poseCommand("robot", 1, TURNED),
      poseCommand("robot", 99, TURNED),
    ]);
    expect(result.status).toBe("failed");
    expect(result.results.map((entry) => ("message" in entry ? entry.message : undefined))).toEqual([
      "Not applied: the batch was rolled back",
      'Object "robot" has no bone 99',
    ]);
    expect(boneOf(editor, "robot", 1)?.rotation.z).toBe(0);
    expect(editor.currentRevision).toBe(revision);
  });

  it("fails for an object that does not exist, or one that has no rig", () => {
    const { editor } = sceneWithRig();
    editor.execute("box", editor.currentRevision, [
      { commandId: "b", type: "geometry.create_primitive", objectId: "crate", primitive: "box", size: 1, replaceExisting: false },
    ]);
    expect(editor.applyUserPose("ghost", 0, TURNED).applied).toBe(false);
    expect(editor.applyUserPose("crate", 0, TURNED).applied).toBe(false);
  });

  it("is not combined with commands that rebuild the scene", () => {
    const { editor } = sceneWithRig();
    const result = editor.execute("mixed", editor.currentRevision, [
      { commandId: "b", type: "geometry.create_primitive", objectId: "crate", primitive: "box", size: 1, replaceExisting: false },
      poseCommand("robot", 1, TURNED),
    ]);
    expect(result.status).toBe("failed");
    expect(editor.getObject("crate")).toBeUndefined();
    expect(boneOf(editor, "robot", 1)?.rotation.z).toBe(0);
  });

  it("keeps the pose when a later batch replaces the model with a copy", () => {
    const { editor } = sceneWithRig();
    editor.applyUserPose("robot", 3, TURNED);
    const before = editor.getObject("robot");
    editor.execute("more", editor.currentRevision, [
      { commandId: "b", type: "geometry.create_primitive", objectId: "crate", primitive: "box", size: 1, replaceExisting: false },
    ]);
    expect(editor.getObject("robot")).not.toBe(before);
    expect(boneOf(editor, "robot", 3)?.rotation.z).toBeCloseTo(0.7);
  });

  it("is applied again, bone for bone, when a saved project is rebuilt", async () => {
    const { editor } = sceneWithRig();
    const first = editor.applyUserPose("robot", 1, TURNED);
    const second = editor.applyUserPose("robot", 4, { ...TURNED, rotation: [0.4, 0, 0] });

    const rebuilt = new EditorScene(new Scene(), "prj_1");
    await rebuilt.restore(
      [
        { kind: "import", assetId: "ast_1", objectId: "robot", name: "rigged", format: "glb" },
        { kind: "commands", proposalId: "usr_1", commands: first.commands },
        { kind: "commands", proposalId: "usr_2", commands: second.commands },
      ],
      async (_step: ImportedModelStep) => buildRiggedModel(5),
    );
    for (const index of [1, 4]) {
      const original = boneOf(editor, "robot", index);
      const copy = boneOf(rebuilt, "robot", index);
      expect(copy && original ? poseOf(copy) : undefined).toEqual(original ? poseOf(original) : null);
    }
  });

  it("frees the skeleton of a model that is deleted", () => {
    const { editor, model } = sceneWithRig();
    const mesh = model.children.find(isSkinnedMesh);
    if (!mesh) throw new Error("expected a skinned mesh");
    const dispose = vi.spyOn(mesh.skeleton, "dispose");
    expect(editor.applyUserEdit(editor.deleteCommandsFor("robot"))).toBe(true);
    expect(editor.getObject("robot")).toBeUndefined();
    expect(dispose).toHaveBeenCalled();
  });
});

describe("a posed model", () => {
  it("can still be clicked where its limb now is, as the bounds of a skinned mesh follow the pose", () => {
    const editor = new EditorScene(new Scene(), "prj_1");
    // The box is skinned to the last bone, so posing that bone carries the whole box with it.
    const model = buildRiggedModel(3, 2);
    editor.importObject("robot", model);
    const mesh = model.children.find(isSkinnedMesh);
    if (!mesh) throw new Error("expected a skinned mesh");
    // The bounds are measured once, as they are the first time the model is drawn or clicked.
    mesh.computeBoundingSphere();

    const camera = new PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(0, 0, 12);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    expect(editor.applyUserPose("robot", 2, { position: [4, 0.5, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }).applied).toBe(true);

    const bone = boneOf(editor, "robot", 2);
    if (!bone) throw new Error("expected a bone");
    const ndc = bone.getWorldPosition(new Vector3()).project(camera);
    expect(pickObjectId(editor, camera, new Vector2(ndc.x, ndc.y))).toBe("robot");
  });
});

describe("reopening a project with poses that no longer fit", () => {
  const steps = (commands: unknown) => [
    { kind: "import" as const, assetId: "ast_1", objectId: "robot", name: "rigged", format: "glb" },
    { kind: "commands" as const, proposalId: "usr_1", commands },
  ];

  it("opens anyway when a saved pose names a bone the model does not have", async () => {
    const editor = new EditorScene(new Scene(), "prj_1");
    await editor.restore(steps([poseCommand("robot", 99, TURNED)]), async () => buildRiggedModel(5));
    expect(editor.getObject("robot")).toBeDefined();
  });

  it("still refuses a project whose other steps cannot be replayed", async () => {
    const editor = new EditorScene(new Scene(), "prj_1");
    const broken = [{ commandId: "t", type: "scene.transform_object", objectId: "ghost", transform: { position: [0, 0, 0] } }];
    await expect(editor.restore(steps(broken), async () => buildRiggedModel(5))).rejects.toThrow("could not be restored");
  });
});

describe("the selected bone", () => {
  it("follows the selected object: choosing another object lets go of it", () => {
    const { editor } = sceneWithRig();
    editor.execute("box", editor.currentRevision, [
      { commandId: "b", type: "geometry.create_primitive", objectId: "crate", primitive: "box", size: 1, replaceExisting: false },
    ]);
    const bones = new BoneSelection(editor);
    let changes = 0;
    bones.onChange(() => (changes += 1));

    editor.select("robot");
    bones.select({ objectId: "robot", bone: 2 });
    expect(bones.selected).toEqual({ objectId: "robot", bone: 2 });
    expect(changes).toBe(1);
    bones.select({ objectId: "robot", bone: 2 });
    expect(changes).toBe(1);

    editor.select("crate");
    expect(bones.selected).toBeUndefined();
    expect(changes).toBe(2);
    bones.dispose();
  });

  it("is let go when its model is deleted, and keeps working after the scene replaces the model", () => {
    const { editor } = sceneWithRig();
    editor.select("robot");
    const bones = new BoneSelection(editor);
    bones.select({ objectId: "robot", bone: 3 });
    editor.execute("box", editor.currentRevision, [
      { commandId: "b", type: "geometry.create_primitive", objectId: "crate", primitive: "box", size: 1, replaceExisting: false },
    ]);
    expect(bones.selected).toEqual({ objectId: "robot", bone: 3 });

    editor.applyUserEdit(editor.deleteCommandsFor("robot"));
    expect(bones.selected).toBeUndefined();
    bones.dispose();
  });
});
