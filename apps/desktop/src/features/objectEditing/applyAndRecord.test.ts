import { describe, expect, it } from "vitest";
import { Scene } from "three";
import { EditorScene, UNSAVED_PROJECT_ID, type ObjectTransform } from "../assistant/EditorScene";
import { applyAndRecord, SAVE_FIRST, type RecordEdit } from "./applyAndRecord";

const there: ObjectTransform = { position: [1, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] };
const here: ObjectTransform = { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] };

function sceneWithBox(projectId: string) {
  const editor = new EditorScene(new Scene(), projectId);
  editor.execute("p", 0, [
    { commandId: "b", type: "geometry.create_primitive", objectId: "box", primitive: "box", size: 1, replaceExisting: false },
  ]);
  return editor;
}

function change(editor: EditorScene) {
  return {
    apply: () => editor.applyUserTransform("box", there),
    revert: () => void editor.applyUserTransform("box", here),
  };
}

const positionOf = (editor: EditorScene) => editor.transformOf("box")?.position;

/** A save that records what it was asked to save, and succeeds or fails as told. */
function saving(outcome: "saved" | "offline") {
  const calls: { projectId: string; commands: readonly unknown[] }[] = [];
  const record: RecordEdit = (projectId, commands) => {
    calls.push({ projectId, commands });
    return outcome === "saved" ? Promise.resolve({ proposalId: "usr_1" }) : Promise.reject(new Error("offline"));
  };
  return { record, calls };
}

describe("applying a change and saving it", () => {
  it("keeps the change and sends the commands that replay it", async () => {
    const editor = sceneWithBox("prj_1");
    const { record, calls } = saving("saved");
    await applyAndRecord(editor, change(editor), record);
    expect(positionOf(editor)).toEqual([1, 0, 0]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.projectId).toBe("prj_1");
    expect(calls[0]?.commands).toMatchObject([{ type: "scene.transform_object", objectId: "box" }]);
  });

  it("puts the scene back when the change cannot be saved, and passes the failure on", async () => {
    const editor = sceneWithBox("prj_1");
    await expect(applyAndRecord(editor, change(editor), saving("offline").record)).rejects.toThrow("offline");
    expect(positionOf(editor)).toEqual([0, 0, 0]);
  });

  it("puts the scene back and saves nothing when the scene refuses the change", async () => {
    const editor = sceneWithBox("prj_1");
    const { record, calls } = saving("saved");
    const refused = {
      apply: () => ({ applied: false, commands: [] }),
      revert: () => void editor.applyUserTransform("box", here),
    };
    await expect(applyAndRecord(editor, refused, record)).rejects.toThrow("could not be applied");
    expect(calls).toHaveLength(0);
  });

  it("asks for the project to be saved first, and changes nothing, when there is no project yet", async () => {
    const editor = sceneWithBox(UNSAVED_PROJECT_ID);
    const { record, calls } = saving("saved");
    await expect(applyAndRecord(editor, change(editor), record)).rejects.toThrow(SAVE_FIRST);
    expect(positionOf(editor)).toEqual([0, 0, 0]);
    expect(calls).toHaveLength(0);
  });
});
