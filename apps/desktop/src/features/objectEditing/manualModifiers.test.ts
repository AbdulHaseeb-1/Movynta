import { beforeEach, expect, it, vi } from "vitest";
import { BoxGeometry, BufferGeometry, Float32BufferAttribute, Group, Mesh, Scene } from "three";
import { EditorScene } from "../assistant/EditorScene";
import { saveModifiers } from "./manualModifiers";
import { recordSceneEdit } from "./sceneEditApi";
vi.mock("./sceneEditApi", () => ({ recordSceneEdit: vi.fn() }));
const record = vi.mocked(recordSceneEdit);
beforeEach(() => {
  record.mockReset();
  record.mockResolvedValue({ proposalId: "saved" });
});
function fixture() {
  const editor = new EditorScene(new Scene(), "project");
  const group = new Group();
  group.add(new Mesh(new BoxGeometry()));
  editor.importObject("box", group);
  return editor;
}
it("saves a nested mesh stack before displaying it and replays it on reopen", async () => {
  const scene = fixture();
  record.mockImplementation(async () => {
    expect(scene.currentRevision).toBe(1);
    return { proposalId: "saved" };
  });
  await saveModifiers(
    scene,
    "box",
    [0],
    [{ id: "round", kind: "bevel", enabled: true, width: 0.1, segments: 4 }],
  );
  expect(scene.currentRevision).toBe(2);
  const commands = record.mock.calls[0]?.[1];
  const reopened = fixture();
  expect(reopened.execute("saved", 1, commands).status).toBe("applied");
  expect(
    reopened.context({ objectId: "box", meshPath: [0], offset: 0, limit: 1 })
      .meshInspection?.modifiers,
  ).toEqual([
    { id: "round", kind: "bevel", enabled: true, width: 0.1, segments: 4 },
  ]);
});
it("does not save invalid geometry and leaves the displayed mesh untouched", async () => {
  const scene = fixture();
  await expect(
    saveModifiers(
      scene,
      "box",
      [0],
      [{ id: "bad", kind: "bevel", enabled: true, width: 20, segments: 4 }],
    ),
  ).rejects.toThrow();
  expect(record).not.toHaveBeenCalled();
  expect(scene.currentRevision).toBe(1);
});
it("keeps the original visible on save failure and requests recovery", async () => {
  const scene = fixture();
  record.mockRejectedValue(new Error("offline"));
  await expect(
    saveModifiers(
      scene,
      "box",
      [0],
      [{ id: "smooth", kind: "subdivision", enabled: true, levels: 1 }],
    ),
  ).rejects.toThrow("offline");
  expect(scene.currentRevision).toBe(1);
  expect(scene.requiresRecovery).toBe(true);
});
it("clears a stack to restore the base", async () => {
  const scene = fixture();
  await saveModifiers(
    scene,
    "box",
    [0],
    [{ id: "smooth", kind: "subdivision", enabled: true, levels: 1 }],
  );
  await saveModifiers(scene, "box", [0], []);
  expect(
    scene.context({ objectId: "box", meshPath: [0], offset: 0, limit: 1 })
      .meshInspection?.stats?.faces,
  ).toBe(6);
});

it("explains why a geometry edit is refused instead of showing a generic failure", async () => {
  const scene = new EditorScene(new Scene(), "project");
  // Three triangles sharing one edge: a non-manifold mesh that subdivision cannot process.
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0.5, 1, 0, 0.5, -1, 0, 0.5, 0, 1], 3));
  geometry.setIndex([0, 1, 2, 0, 1, 3, 0, 1, 4]);
  const group = new Group();
  group.add(new Mesh(geometry));
  scene.importObject("open", group);
  await expect(
    saveModifiers(scene, "open", [0], [{ id: "smooth", kind: "subdivision", enabled: true, levels: 1, method: "loop" }]),
  ).rejects.toThrow("manifold");
  expect(record).not.toHaveBeenCalled();
  expect(scene.currentRevision).toBe(1);
});
