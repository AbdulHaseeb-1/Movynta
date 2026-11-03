import { expect, it, vi } from "vitest";
import { Scene } from "three";
import { EditorScene } from "@/features/assistant/EditorScene";
import { saveManualCommands } from "@/features/objectEditing/saveManualCommands";
vi.mock("@/features/objectEditing/sceneEditApi", () => ({ recordSceneEdit: vi.fn(async () => ({ proposalId: "saved" })) }));
it.each(["box", "sphere", "cylinder", "cone", "torus", "plane"])("creates, saves and replays a %s", async (primitive) => {
  const editor = new EditorScene(new Scene(), "project");
  const commands = [{ commandId: "new", type: "geometry.create_primitive", objectId: "shape", primitive, size: 2, replaceExisting: false }, { commandId: "place", type: "scene.transform_object", objectId: "shape", transform: { position: [0, 1, 0] } }];
  await saveManualCommands(editor, commands); expect(editor.getObject("shape")).toBeDefined();
  const reopened = new EditorScene(new Scene(), "project"); expect(reopened.execute("saved", 0, commands).status).toBe("applied"); expect(reopened.getObject("shape")?.position.y).toBe(1);
});
