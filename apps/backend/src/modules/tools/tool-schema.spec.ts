import { z } from "zod";
import { meshInspectionRequestSchema } from "@movynta/editor-protocol";
import { editorCommandListSchema, MAX_COMMANDS_PER_PROPOSAL } from "../../shared/schemas/editor-command.schema.js";
import type { EditorContext } from "../../shared/types/editor-context.types.js";
import { editorContextSchema } from "../../shared/schemas/editor-context.schema.js";
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
  it("validates shape-specific dimensions and face queries", () => {
    const primitive = { commandId: "p", type: "geometry.create_primitive", objectId: "shape", size: 2 };
    expect(editorCommandListSchema.safeParse([{ ...primitive, primitive: "cylinder", options: { radiusTop: 0, radiusBottom: 1, height: 4, radialSegments: 32 } }]).success).toBe(true);
    expect(editorCommandListSchema.safeParse([{ ...primitive, primitive: "icosahedron", options: { radius: 3, detail: 2 } }]).success).toBe(true);
    expect(editorCommandListSchema.safeParse([{ ...primitive, primitive: "box", options: { radius: 1 } }]).success).toBe(false);
    expect(editorCommandListSchema.safeParse([{ ...primitive, primitive: "cylinder", options: { radiusTop: 0, radiusBottom: 0 } }]).success).toBe(false);
    expect(editorCommandListSchema.safeParse([{ ...primitive, primitive: "torus", options: { radius: 1, tube: 2 } }]).success).toBe(false);
    expect(editorCommandListSchema.safeParse([{ ...primitive, primitive: "sphere", options: { widthSegments: 128, heightSegments: 128 } }]).success).toBe(false);
    expect(meshInspectionRequestSchema.safeParse({ objectId: "shape", faceQuery: { normal: [0, 1, 0], centerMin: [-1, 0, -1] }, includeSamples: false }).success).toBe(true);
    expect(meshInspectionRequestSchema.safeParse({ objectId: "shape", faceQuery: { normal: [0, 0, 0] } }).success).toBe(false);
    expect(meshInspectionRequestSchema.safeParse({ objectId: "shape", faceQuery: { centerMin: [2, 0, 0], centerMax: [1, 1, 1] } }).success).toBe(false);
  });
  it("validates bounded custom polygon meshes", () => {
    const mesh = { commandId: "m", type: "geometry.create_mesh", objectId: "shape", vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], faces: [[0, 1, 2]] };
    expect(editorCommandListSchema.safeParse([mesh]).success).toBe(true);
    expect(editorCommandListSchema.safeParse([{ ...mesh, faces: [[0, 1, 4]] }]).success).toBe(false);
    expect(editorCommandListSchema.safeParse([{ ...mesh, faces: [[0, 1, 1]] }]).success).toBe(false);
    expect(editorCommandListSchema.safeParse([{ ...mesh, vertices: [[10001, 0, 0], [1, 0, 0], [0, 1, 0]] }]).success).toBe(false);
    expect(editorCommandListSchema.safeParse([{ ...mesh, vertices: [...mesh.vertices, [0, 0, 1]] }]).success).toBe(false);
  });
  it("requires exactly one extrusion direction and restricts normal distance to faces", () => {
    const command = { commandId: "ex", type: "geometry.extrude", objectId: "box", kind: "face", ids: ["0"] };
    expect(editorCommandListSchema.safeParse([{ ...command, componentView: "base", normalDistance: -0.5 }]).success).toBe(true);
    for (const fields of [{}, { normalDistance: 0 }, { offset: [0, 0, 0] }, { normalDistance: 1, offset: [0, 1, 0] },
      { kind: "edge", ids: ["0_1"], normalDistance: 1 }, { componentView: "evaluated", offset: [0, 1, 0] }]) {
      expect(editorCommandListSchema.safeParse([{ ...command, ...fields }]).success).toBe(false);
    }
  });
  it("validates shaped extrusion and anchors a live extrusion to the first stack entry", () => {
    const base = { commandId: "ex", type: "geometry.extrude", objectId: "box", kind: "face", ids: ["0"] };
    expect(editorCommandListSchema.safeParse([{ ...base, normalDistance: 1, capScale: 0.5, twistDegrees: 15, closeOpenSurface: true }]).success).toBe(true);
    expect(editorCommandListSchema.safeParse([{ ...base, offset: [0, 1, 0], closeOpenSurface: true }]).success).toBe(false);
    expect(editorCommandListSchema.safeParse([{ ...base, kind: "edge", ids: ["0_1"], offset: [0, 1, 0], capScale: 0.5 }]).success).toBe(false);
    const extrusion = { id: "ext", kind: "extrusion", ids: ["0"], normalDistance: 1, baseKey: "0123456789abcdef" };
    const subdivision = { id: "sub", kind: "subdivision", levels: 1 };
    const command = { commandId: "stack", type: "geometry.set_modifiers", objectId: "box" };
    expect(editorCommandListSchema.safeParse([{ ...command, modifiers: [extrusion, subdivision] }]).success).toBe(true);
    expect(editorCommandListSchema.safeParse([{ ...command, modifiers: [subdivision, extrusion] }]).success).toBe(false);
    expect(editorCommandListSchema.safeParse([{ ...command, modifiers: [{ ...extrusion, baseKey: "invalid" }] }]).success).toBe(false);
    expect(editorCommandListSchema.safeParse([{ ...base, normalDistance: 1, normalMode: "individual", capScaleXY: [0.5, 1.2], capRotationDegrees: [20, 0, 0] }]).success).toBe(true);
    expect(editorCommandListSchema.safeParse([{ ...base, normalDistance: 1, capScale: 1, capScaleXY: [1, 2] }]).success).toBe(false);
    const { normalDistance: _normalDistance, ...live } = extrusion;
    expect(editorCommandListSchema.safeParse([{ ...command, modifiers: [{ ...live, componentKind: "edge", ids: ["0_1"], offset: [0, 1, 0] }] }]).success).toBe(true);
    const fill = { commandId: "fill", type: "geometry.fill_hole", objectId: "box", ids: ["0_1", "1_2", "0_2"] };
    expect(editorCommandListSchema.safeParse([fill]).success).toBe(true);
    expect(editorCommandListSchema.safeParse([{ ...fill, ids: ["0", "1", "2"] }]).success).toBe(false);
  });
  it("accepts explicit base or evaluated mesh inspection and rejects other views", () => {
    expect(meshInspectionRequestSchema.parse({ objectId: "a", view: "base" }).view).toBe("base");
    expect(meshInspectionRequestSchema.parse({ objectId: "a", view: "evaluated" }).view).toBe("evaluated");
    expect(meshInspectionRequestSchema.safeParse({ objectId: "a", view: "other" }).success).toBe(false);
    expect(meshInspectionRequestSchema.safeParse({ objectId: "a" }).success).toBe(true);
  });
  it("accepts rounded bevels and bounded live stacks and rejects duplicate ids", () => {
    const stack = [{ id: "smooth", kind: "subdivision", enabled: false, levels: 2 }];
    expect(editorCommandListSchema.safeParse([{ commandId: "s", type: "geometry.set_modifiers", objectId: "mesh", modifiers: stack }]).success).toBe(true);
    expect(editorCommandListSchema.safeParse([{ commandId: "s", type: "geometry.set_modifiers", objectId: "mesh", modifiers: [...stack, ...stack] }]).success).toBe(false);
    const cut = { id: "cut", kind: "boolean", operandObjectId: "cutter" };
    expect(editorCommandListSchema.parse([{ commandId: "s", type: "geometry.set_modifiers", objectId: "mesh", modifiers: [cut] }])[0]).toMatchObject({ modifiers: [{ operation: "difference", operandMeshPath: [] }] });
    expect(editorCommandListSchema.safeParse([{ commandId: "s", type: "geometry.set_modifiers", objectId: "mesh", modifiers: [{ ...cut, operation: "union" }] }]).success).toBe(true);
    expect(editorCommandListSchema.safeParse([{ commandId: "s", type: "geometry.set_modifiers", objectId: "mesh", modifiers: [{ ...cut, operation: "carve" }] }]).success).toBe(false);
    expect(editorCommandListSchema.safeParse([{ commandId: "s", type: "geometry.set_modifiers", objectId: "mesh", modifiers: [{ id: "cut", kind: "boolean" }] }]).success).toBe(false);
    for (const segments of [0, 9, 1.5]) expect(editorCommandListSchema.safeParse([{ commandId: "b", type: "geometry.bevel", objectId: "mesh", width: .1, segments }]).success).toBe(false);
  });
  it("validates bounded bevel/subdivision parameters and supplies the root mesh path", () => {
    const result = editorCommandListSchema.parse([{ commandId: "b", type: "geometry.bevel", objectId: "a", width: .1 }]);
    expect(result[0]).toMatchObject({ meshPath: [] });
    for (const levels of [0, 4, 1.5]) expect(editorCommandListSchema.safeParse([{ commandId: "s", type: "geometry.subdivide", objectId: "a", levels }]).success).toBe(false);
    for (const width of [0, -1, Number.NaN, 101]) expect(editorCommandListSchema.safeParse([{ commandId: "b", type: "geometry.bevel", objectId: "a", width }]).success).toBe(false);
    expect(editorCommandListSchema.parse([{ commandId: "s", type: "geometry.subdivide", objectId: "a", levels: 1 }])[0]).not.toHaveProperty("method");
    expect(editorCommandListSchema.safeParse([{ commandId: "s", type: "geometry.subdivide", objectId: "a", levels: 1, method: "loop" }]).success).toBe(true);
    expect(editorCommandListSchema.safeParse([{ commandId: "s", type: "geometry.subdivide", objectId: "a", levels: 1, method: "nurbs" }]).success).toBe(false);
    expect(editorCommandListSchema.safeParse([{ commandId: "b", type: "geometry.bevel", objectId: "a", width: .1, profile: "chamfer", angle: 30 }]).success).toBe(true);
    expect(editorCommandListSchema.safeParse([{ commandId: "b", type: "geometry.bevel", objectId: "a", width: .1, angle: 181 }]).success).toBe(false);
    expect(editorCommandListSchema.safeParse([{ commandId: "e", type: "geometry.extrude", objectId: "a", kind: "face", ids: ["0"], offset: [0, 1, 0] }]).success).toBe(true);
    expect(editorCommandListSchema.safeParse([{ commandId: "e", type: "geometry.extrude", objectId: "a", kind: "loop", ids: ["0"], offset: [0, 1, 0] }]).success).toBe(false);
    expect(editorCommandListSchema.safeParse([{ commandId: "e", type: "geometry.extrude", objectId: "a", kind: "face", ids: [], offset: [0, 1, 0] }]).success).toBe(false);
    expect(editorCommandListSchema.safeParse([{ commandId: "f", type: "geometry.subdivide_faces", objectId: "a", ids: ["0", "12"] }]).success).toBe(true);
    expect(editorCommandListSchema.safeParse([{ commandId: "f", type: "geometry.subdivide_faces", objectId: "a", ids: [] }]).success).toBe(false);
    const focus = { ...emptyScene, designFocus: { mode: "edit", componentKind: "face", componentSelection: { objectId: "a", meshPath: [0], kind: "face", ids: ["0", "3_4"], modifiersEnabled: false } } };
    expect(editorContextSchema.safeParse(focus).success).toBe(true);
    const selection = focus.designFocus.componentSelection;
    expect(editorContextSchema.safeParse({
      ...focus, designFocus: { ...focus.designFocus, componentSelection: { ...selection, baseFaceIds: ["0", "2"] } },
    }).success).toBe(true);
    expect(editorContextSchema.safeParse({
      ...focus, designFocus: { ...focus.designFocus, componentSelection: { ...selection, baseFaceIds: ["0_1"] } },
    }).success).toBe(false);
    expect(editorContextSchema.safeParse({ ...focus, designFocus: { mode: "edit", componentKind: "face", componentSelection: { objectId: "a", meshPath: [], kind: "face", ids: ["0"] } } }).success).toBe(false);
    expect(editorCommandListSchema.safeParse([{ commandId: "f", type: "geometry.subdivide_faces", objectId: "a", ids: ["0_1"] }]).success).toBe(false);
  });
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

describe("mesh paths in requests and commands", () => {
  it("accepts part names, indexes and a mixture in an inspection request and in commands", () => {
    for (const meshPath of [[0, 2], ["Body", "Arm#1"], ["Body", 3]]) {
      expect(meshInspectionRequestSchema.safeParse({ objectId: "model", meshPath }).success).toBe(true);
      expect(editorCommandListSchema.safeParse([{ commandId: "s", type: "geometry.subdivide", objectId: "model", meshPath, levels: 1 }]).success).toBe(true);
    }
  });

  it("accepts a name in a boolean operand path, and refuses what is not a path", () => {
    const modifier = (operandMeshPath: unknown) => [{
      commandId: "b", type: "geometry.set_modifiers", objectId: "box",
      modifiers: [{ id: "cut", kind: "boolean", operandObjectId: "model", operandMeshPath }],
    }];
    expect(editorCommandListSchema.safeParse(modifier(["Cutter"])).success).toBe(true);
    for (const bad of [[""], [-1], [{}], ["x".repeat(131)]]) expect(editorCommandListSchema.safeParse(modifier(bad)).success).toBe(false);
  });

  it("is sent to model providers as a list whose items are an integer or a string, never as a tuple", () => {
    const json = JSON.stringify(z.toJSONSchema(editorCommandListSchema));
    expect(json).not.toContain("prefixItems");
    expect(json).toContain('"items":{"anyOf":[{"type":"integer"');
  });
});

describe("checkScene arrangement checks", () => {
  const object = (id: string, parentId: string | null, name: string, scale: [number, number, number] = [1, 1, 1], type: "mesh" | "empty" = "mesh") => ({
    id, name, type, parentId, transform: { position: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0] as [number, number, number], scale },
  });
  const check = (...objects: ReturnType<typeof object>[]) => checkScene({ ...emptyScene, objects });
  const found = (result: ReturnType<typeof check>, severity: string) => result.issues.filter((issue) => issue.severity === severity);

  it("warns when objects under one parent share a name, and says which", () => {
    const result = check(object("a", null, "Arm"), object("b", null, "Arm"), object("c", null, "Leg"));
    expect(found(result, "warning").map((issue) => issue.objectId)).toEqual(["b"]);
    expect(found(result, "warning")[0]?.message).toContain('"Arm"');
    expect(result.ok).toBe(true);
  });

  it("allows the same name under different parents", () => {
    const result = check(object("l", null, "Left", [1, 1, 1], "empty"), object("r", null, "Right", [1, 1, 1], "empty"), object("a", "l", "Arm"), object("b", "r", "Arm"));
    expect(found(result, "warning")).toEqual([]);
  });

  it("warns about a group with children scaled by different amounts, not one without children or one scaled evenly", () => {
    const result = check(
      object("uneven", null, "Uneven", [2, 1, 1], "empty"), object("a", "uneven", "A"),
      object("lonely", null, "Lonely", [2, 1, 1], "empty"),
      object("even", null, "Even", [2, 2, 2], "empty"), object("b", "even", "B"),
    );
    const warnings = found(result, "warning");
    expect(warnings.map((issue) => issue.objectId)).toEqual(["uneven"]);
    expect(warnings[0]?.message).toContain("same scale on every axis");
  });

  it("notes an empty group as information, which does not fail the check", () => {
    const result = check(object("g", null, "Group", [1, 1, 1], "empty"), object("full", null, "Full", [1, 1, 1], "empty"), object("m", "full", "Mesh"));
    expect(found(result, "info").map((issue) => issue.objectId)).toEqual(["g"]);
    expect(result.ok).toBe(true);
  });
});

describe("checkScene collection checks", () => {
  const withCollections = (collections: { id: string; name: string; parentId: string | null }[], objects: { id: string; collectionId: string | null }[] = []): EditorContext => ({
    ...emptyScene,
    collections: collections.map((collection) => ({ ...collection, visible: true })),
    objects: objects.map((object) => ({
      id: object.id, name: object.id, type: "mesh", parentId: null, collectionId: object.collectionId,
      transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    })) as unknown as EditorContext["objects"],
  });
  const messages = (scene: EditorContext, severity: string) => checkScene(scene).issues.filter((issue) => issue.severity === severity).map((issue) => issue.message);

  it("passes a scene whose collections hold objects", () => {
    const result = checkScene(withCollections([{ id: "set", name: "Set", parentId: null }], [{ id: "a", collectionId: "set" }]));
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("reports an object in a collection that does not exist, and a collection in one that does not exist", () => {
    const scene = withCollections([{ id: "c", name: "C", parentId: "gone" }], [{ id: "a", collectionId: "nowhere" }]);
    expect(messages(scene, "error")).toEqual(expect.arrayContaining(['Is in collection "nowhere", which does not exist', 'Collection "c" sits in "gone", which does not exist']));
    expect(checkScene(scene).ok).toBe(false);
  });

  it("reports collections that sit inside themselves", () => {
    const scene = withCollections([{ id: "a", name: "A", parentId: "b" }, { id: "b", name: "B", parentId: "a" }]);
    expect(messages(scene, "error").some((message) => message.includes("inside itself"))).toBe(true);
  });

  it("warns about collections that share a name in one place, not in different places", () => {
    expect(messages(withCollections([{ id: "a", name: "Props", parentId: null }, { id: "b", name: "Props", parentId: null }]), "warning")).toHaveLength(1);
    expect(messages(withCollections([{ id: "a", name: "Props", parentId: null }, { id: "set", name: "Set", parentId: null }, { id: "b", name: "Props", parentId: "set" }]), "warning")).toEqual([]);
  });

  it("notes an empty collection as information only, and one that holds only another collection is not empty", () => {
    const scene = withCollections([{ id: "outer", name: "Outer", parentId: null }, { id: "inner", name: "Inner", parentId: "outer" }]);
    expect(messages(scene, "info")).toEqual(['Collection "inner" (Inner) is empty']);
    expect(checkScene(scene).ok).toBe(true);
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
    expect(issues[0]?.message).toContain(`"ghost" does not exist`);
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
