import { z } from "zod";
import { editorCommandListSchema, MAX_COMMANDS_PER_PROPOSAL } from "../../shared/schemas/editor-command.schema.js";
import type { EditorContext } from "../../shared/schemas/editor-context.schema.js";
import { validateAgainstContext } from "../editor-bridge/proposals/command-proposal.service.js";
import { defineTool, toProviderToolName } from "./tool.types.js";
import { checkScene } from "./validation/validation.tools.js";

const emptyScene: EditorContext = {
  projectId: "p",
  revision: 0,
  activeSceneName: "Main",
  selectedObjectIds: [],
  objects: [],
};

const sceneWith = (ids: string[]): EditorContext => ({
  ...emptyScene,
  objects: ids.map((id) => ({
    id,
    name: id,
    type: "mesh",
    parentId: null,
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
  })),
});

describe("editor command schema", () => {
  it("accepts a valid mixed batch", () => {
    const parsed = editorCommandListSchema.safeParse([
      { commandId: "c1", type: "scene.create_object", objectId: "torso", name: "Torso" },
      { commandId: "c2", type: "scene.transform_object", objectId: "torso", transform: { position: [0, 1, 0] } },
      { commandId: "c3", type: "scene.delete_object", objectId: "old" },
    ]);
    expect(parsed.success).toBe(true);
  });

  it("rejects an unknown command type", () => {
    expect(editorCommandListSchema.safeParse([{ commandId: "c1", type: "shell.exec", objectId: "x" }]).success).toBe(false);
  });

  it("rejects non-finite numbers in transforms", () => {
    const result = editorCommandListSchema.safeParse([
      { commandId: "c1", type: "scene.transform_object", objectId: "torso", transform: { position: [Number.NaN, 0, 0] } },
    ]);
    expect(result.success).toBe(false);
  });

  it("rejects extra keys that could smuggle code or instructions", () => {
    const result = editorCommandListSchema.safeParse([
      { commandId: "c1", type: "scene.delete_object", objectId: "x", script: "process.exit()" },
    ]);
    expect(result.success).toBe(false);
  });

  it("caps the batch size", () => {
    const batch = Array.from({ length: MAX_COMMANDS_PER_PROPOSAL + 1 }, (_, index) => ({
      commandId: `c${index}`,
      type: "scene.delete_object",
      objectId: `o${index}`,
    }));
    expect(editorCommandListSchema.safeParse(batch).success).toBe(false);
  });
});

describe("tool definitions", () => {
  it("requires namespace.name tool names", () => {
    expect(() => defineTool({ name: "Bad-Name", description: "x", permission: "read", parameters: z.object({}), execute: () => ({}) })).toThrow(
      /Invalid tool name/,
    );
  });

  it("validates input before the handler runs", async () => {
    const tool = defineTool({
      name: "sample.echo",
      description: "Echo a value",
      permission: "read",
      parameters: z.object({ value: z.string().max(5) }).strict(),
      execute: (input) => input.value,
    });
    await expect(tool.execute({ value: "toolongvalue" }, undefined as never)).rejects.toThrow();
    await expect(tool.execute({ value: "ok" }, undefined as never)).resolves.toBe("ok");
  });

  it("maps dotted registry names to model-safe provider names", () => {
    expect(toProviderToolName("editor.apply_proposal")).toBe("editor__apply_proposal");
  });
});

describe("checkScene", () => {
  it("passes a clean scene", () => {
    expect(checkScene(sceneWith(["a", "b"])).ok).toBe(true);
  });

  it("reports missing parents, parent cycles, and non-positive scale", () => {
    const scene: EditorContext = {
      ...emptyScene,
      objects: [
        { id: "a", name: "a", type: "mesh", parentId: "missing", transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
        { id: "b", name: "b", type: "mesh", parentId: "c", transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
        { id: "c", name: "c", type: "mesh", parentId: "b", transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [0, 1, 1] } },
      ],
    };
    const messages = checkScene(scene).issues.map((issue) => issue.message);
    expect(messages).toEqual(
      expect.arrayContaining(["Parent does not exist", "Parent chain contains a cycle", "Scale must be positive on every axis"]),
    );
    expect(checkScene(scene).ok).toBe(false);
  });
});

describe("validateAgainstContext", () => {
  it("flags creating an object that already exists", () => {
    const issues = validateAgainstContext(
      [{ commandId: "c1", type: "scene.create_object", objectId: "torso", name: "Torso" }],
      sceneWith(["torso"]),
    );
    expect(issues).toHaveLength(1);
  });

  it("flags transforms of unknown objects", () => {
    const issues = validateAgainstContext(
      [{ commandId: "c1", type: "scene.transform_object", objectId: "ghost", transform: { position: [0, 0, 0] } }],
      emptyScene,
    );
    expect(issues[0]?.message).toBe("objectId does not exist");
  });

  it("allows creating an object and then transforming it in the same batch", () => {
    const issues = validateAgainstContext(
      [
        { commandId: "c1", type: "scene.create_object", objectId: "arm", name: "Arm" },
        { commandId: "c2", type: "scene.transform_object", objectId: "arm", transform: { position: [1, 0, 0] } },
      ],
      emptyScene,
    );
    expect(issues).toEqual([]);
  });
});
