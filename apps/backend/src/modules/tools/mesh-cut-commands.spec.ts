import { CAGE_EDIT_COMMAND_TYPES, meshInspectionRequestSchema, TOPOLOGY_EDIT_COMMAND_TYPES, editorCommandListSchema, editorCommandSchema, validateAgainstContext, type EditorContext } from "@movynta/editor-protocol";

const base = { commandId: "cut", objectId: "mesh" };
const scene: EditorContext = {
  projectId: "p", revision: 3, activeSceneName: "Main", selectedObjectIds: [],
  objects: [{ id: "mesh", name: "Mesh", type: "mesh", parentId: null, visible: true, transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } }],
};
const ok = (fields: Record<string, unknown>) => editorCommandListSchema.safeParse([{ ...base, ...fields }]).success;

describe("plane cut, delete, flip and triangulate commands", () => {
  it("accepts a plane as a point and normal or as an axis and offset, and fills in defaults", () => {
    const [axis] = editorCommandListSchema.parse([{ ...base, type: "geometry.bisect", plane: { axis: "y", offset: 0.5 } }]);
    expect(axis).toMatchObject({ space: "local", keep: "both", fill: false, componentView: "base", meshPath: [] });
    expect(ok({ type: "geometry.bisect", plane: { point: [0, 1, 0], normal: [0, 1, 0] }, space: "world", keep: "negative", fill: true })).toBe(true);
    expect(ok({ type: "geometry.bisect", plane: { axis: "x", offset: -2 }, ids: ["0", "3"], snapDistance: 0.001 })).toBe(true);
  });

  it.each([
    ["a zero normal", { plane: { point: [0, 0, 0], normal: [0, 0, 0] } }],
    ["a plane with both forms", { plane: { axis: "y", offset: 0, point: [0, 0, 0] } }],
    ["an unknown axis", { plane: { axis: "w", offset: 0 } }],
    ["a plane with no position", { plane: {} }],
    ["a non-finite offset", { plane: { axis: "y", offset: Number.POSITIVE_INFINITY } }],
    ["fill without a side to keep", { plane: { axis: "y", offset: 0 }, fill: true }],
    ["a face list with a one-sided cut", { plane: { axis: "y", offset: 0 }, keep: "positive", ids: ["0"] }],
    ["duplicate face ids", { plane: { axis: "y", offset: 0 }, ids: ["1", "1"] }],
    ["an evaluated view", { plane: { axis: "y", offset: 0 }, componentView: "evaluated" }],
    ["a zero snap distance", { plane: { axis: "y", offset: 0 }, snapDistance: 0 }],
  ])("rejects bisect with %s", (_name, fields) => {
    expect(ok({ type: "geometry.bisect", ...fields })).toBe(false);
  });

  it("matches delete ids to the component kind", () => {
    expect(ok({ type: "geometry.delete_components", kind: "face", ids: ["0", "1"] })).toBe(true);
    expect(ok({ type: "geometry.delete_components", kind: "vertex", ids: ["4"] })).toBe(true);
    expect(ok({ type: "geometry.delete_components", kind: "edge", ids: ["0_1"] })).toBe(true);
    for (const fields of [{ kind: "edge", ids: ["1"] }, { kind: "face", ids: ["0_1"] }, { kind: "edge", ids: ["1_0"] }, { kind: "face", ids: ["0", "0"] }, { kind: "face", ids: [] }, { kind: "solid", ids: ["0"] }]) {
      expect(ok({ type: "geometry.delete_components", ...fields })).toBe(false);
    }
  });

  it("takes optional unique face ids for flip and triangulate", () => {
    for (const type of ["geometry.flip_normals", "geometry.triangulate_faces"]) {
      expect(ok({ type })).toBe(true);
      expect(ok({ type, ids: ["0", "5"] })).toBe(true);
      expect(ok({ type, ids: [] })).toBe(false);
      expect(ok({ type, ids: ["2", "2"] })).toBe(false);
      expect(ok({ type, ids: ["1_2"] })).toBe(false);
    }
  });

  it("validates shading and loop bridging", () => {
    expect(editorCommandListSchema.parse([{ ...base, type: "geometry.set_shading", mode: "flat" }])[0]).toMatchObject({ componentView: "base" });
    expect(ok({ type: "geometry.set_shading", mode: "smooth", angle: 30 })).toBe(true);
    for (const fields of [{ mode: "round" }, { mode: "flat", angle: 30 }, { mode: "smooth", angle: 0 }, { mode: "smooth", angle: 180 }, {}]) {
      expect(ok({ type: "geometry.set_shading", ...fields })).toBe(false);
    }
    const loops = ["0_1", "1_2", "0_2", "3_4", "4_5", "3_5"];
    expect(editorCommandListSchema.parse([{ ...base, type: "geometry.bridge_edge_loops", ids: loops }])[0]).toMatchObject({ twist: 0 });
    expect(ok({ type: "geometry.bridge_edge_loops", ids: loops, twist: -2 })).toBe(true);
    for (const fields of [{ ids: loops.slice(0, 5) }, { ids: [...loops.slice(0, 5), "0_1"] }, { ids: [...loops.slice(0, 5), "2_1"] }, { ids: loops, twist: 1.5 }, { ids: loops, twist: 300 }]) {
      expect(ok({ type: "geometry.bridge_edge_loops", ...fields })).toBe(false);
    }
  });

  it("validates separation and treats the new object id as taken", () => {
    expect(ok({ type: "geometry.separate_faces", ids: ["0", "1"], newObjectId: "part", name: "Part" })).toBe(true);
    for (const fields of [{ ids: ["0"] }, { ids: [], newObjectId: "part" }, { ids: ["0"], newObjectId: "mesh" }, { ids: ["0"], newObjectId: "a b" },
      { ids: ["0", "0"], newObjectId: "part" }, { ids: ["0"], newObjectId: "part", meshPath: ["Arm"] }, { ids: ["0"], newObjectId: "part", componentView: "evaluated" }]) {
      expect(ok({ type: "geometry.separate_faces", ...fields })).toBe(false);
    }
    const split = editorCommandListSchema.parse([{ ...base, type: "geometry.separate_faces", ids: ["0"], newObjectId: "part" }]);
    expect(validateAgainstContext(split, scene)).toEqual([]);
    const taken: EditorContext = { ...scene, objects: [...scene.objects, { id: "part", name: "Part", type: "mesh", parentId: null, visible: true, transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } }] };
    expect(validateAgainstContext(split, taken)[0]?.message).toContain("part");
    expect(validateAgainstContext(editorCommandListSchema.parse([{ ...base, objectId: "ghost", type: "geometry.separate_faces", ids: ["0"], newObjectId: "part" }]), scene)[0]?.message).toContain("ghost");
    const flip = editorCommandListSchema.parse([{ ...base, commandId: "flip", type: "geometry.flip_normals" }])[0];
    if (!flip || !split[0]) throw new Error("parse failed");
    expect(validateAgainstContext([split[0], flip], scene)[0]?.message).toContain("one topology-changing edit");
  });

  it("accepts openings and shells in an inspection request, with bounded paging", () => {
    const accepts = (fields: Record<string, unknown>) => meshInspectionRequestSchema.safeParse({ objectId: "mesh", view: "base", ...fields }).success;
    expect(accepts({ openings: {} })).toBe(true);
    expect(accepts({ shells: {} })).toBe(true);
    expect(accepts({ openings: { offset: 20, limit: 50 }, shells: { offset: 0, limit: 1 }, includeSamples: false })).toBe(true);
    for (const fields of [{ openings: { limit: 0 } }, { openings: { limit: 51 } }, { shells: { limit: 51 } }, { shells: { offset: -1 } },
      { openings: { surprise: true } }, { shells: 3 }, { openings: { limit: 1.5 } }]) {
      expect(accepts(fields)).toBe(false);
    }
  });

  it("keeps the shared command lists in step with the schema", () => {
    const types = new Map<string, boolean>();
    for (const option of editorCommandSchema.options) {
      const shape = option.shape as Record<string, { value?: unknown }>;
      types.set(String(shape["type"]?.value), "componentView" in shape);
    }
    // A command that works on base IDs belongs to the cage-edit list, or its revision and batch rules are skipped.
    for (const [type, hasView] of types) if (hasView && type !== "geometry.transform_components") expect({ type, listed: CAGE_EDIT_COMMAND_TYPES.has(type) }).toEqual({ type, listed: true });
    expect(CAGE_EDIT_COMMAND_TYPES.has("geometry.transform_components")).toBe(true);
    for (const type of [...CAGE_EDIT_COMMAND_TYPES, ...TOPOLOGY_EDIT_COMMAND_TYPES]) expect(types.has(type)).toBe(true);
    for (const type of TOPOLOGY_EDIT_COMMAND_TYPES) expect(CAGE_EDIT_COMMAND_TYPES.has(type)).toBe(true);
  });

  it("allows one topology edit per proposal and flags a missing object", () => {
    const cut = { ...base, type: "geometry.bisect", plane: { axis: "y", offset: 0 } } as const;
    const flip = { ...base, commandId: "flip", type: "geometry.flip_normals" } as const;
    const [bisect, flipped] = editorCommandListSchema.parse([cut, flip]);
    if (!bisect || !flipped) throw new Error("parse failed");
    expect(validateAgainstContext([bisect], scene)).toEqual([]);
    expect(validateAgainstContext([bisect, flipped], scene)[0]?.message).toContain("one topology-changing edit");
    expect(validateAgainstContext([flipped], scene)).toEqual([]);
    const missing = editorCommandListSchema.parse([{ ...cut, objectId: "ghost" }]);
    expect(validateAgainstContext(missing, scene)[0]?.message).toContain("ghost");
  });
});
