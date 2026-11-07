import { z } from "zod";
import { materialPropertiesSchema } from "./material.schema.js";
import { MAX_MESH_INPUT_TRIANGLES, meshPathSchema } from "./mesh.schema.js";
import { bevelProfileSchema, booleanOperandFields, extrusionShapeFields, modifierListSchema, subdivisionMethodSchema, validExtrusionShape } from "./modifier.schema.js";

/** Upper bound for commands in one proposal. */
export const MAX_COMMANDS_PER_PROPOSAL = 200;
/** Segment limit for interactive and assistant-selected edge bevels. */
export const MAX_SELECTED_BEVEL_SEGMENTS = 32;

export const identifierSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, "Identifiers use letters, digits, '_' or '-'");
// A fixed-length array rather than z.tuple: tuples become `items: [...]` in JSON Schema, which model
// providers reject when this schema is sent as a tool definition.
const vector3 = z.array(z.number().finite()).length(3);

export const transformSchema = z
  .object({
    position: vector3.optional(),
    rotation: vector3.optional(),
    scale: vector3.optional(),
  })
  .strict();

const commandBase = { commandId: identifierSchema };
const nameSchema = z.string().min(1).max(80);
const dimension = z.number().finite().positive().max(100);
const vertexId = z.string().regex(/^(0|[1-9]\d{0,9})$/);
const edgeId = z.string().regex(/^(0|[1-9]\d{0,9})_(0|[1-9]\d{0,9})$/)
  .refine((id) => Number(id.split("_")[0]) < Number(id.split("_")[1]), "Use canonical smaller_larger edge IDs");
const baseEdit = { ...commandBase, objectId: identifierSchema, meshPath: meshPathSchema.default([]), componentView: z.literal("base").default("base") };
const knifePoint = z.union([z.object({ edge: edgeId, factor: z.number().finite().gt(1e-8).lt(1 - 1e-8) }).strict(), z.object({ vertex: vertexId }).strict()]);
const knifeSegment = z.object({ face: vertexId, start: knifePoint, end: knifePoint }).strict().refine((segment) => !("edge" in segment.start && "edge" in segment.end && segment.start.edge === segment.end.edge) && !("vertex" in segment.start && "vertex" in segment.end && segment.start.vertex === segment.end.vertex), "Cut endpoints must be distinct");
const uniqueVertices = z.array(vertexId).min(2).max(4096).refine((ids) => new Set(ids).size === ids.length, "Vertex IDs must be unique");
const uniqueEdges = z.array(edgeId).min(1).max(4096).refine((ids) => new Set(ids).size === ids.length, "Edge IDs must be unique");
const uniqueFaces = z.array(vertexId).min(1).max(4096).refine((ids) => new Set(ids).size === ids.length, "Face IDs must be unique");
const planeVector = (message: string) => vector3.refine((values) => values.every((value) => Math.abs(value) <= 1_000_000), message);
/** A cut plane: a point on it and its normal, or an axis-aligned plane given by its offset along that axis. */
const cutPlane = z.union([
  z.object({ point: planeVector("Plane point must be within ±1000000"),
    normal: planeVector("Plane normal must be within ±1000000").refine((values) => values.some((value) => Math.abs(value) > 1e-9), "Plane normal must be nonzero") }).strict(),
  z.object({ axis: z.enum(["x", "y", "z"]), offset: z.number().finite().min(-1_000_000).max(1_000_000) }).strict(),
]);
const primitiveOptions = z.object({
  width: dimension.optional(), height: dimension.optional(), depth: dimension.optional(),
  radius: dimension.optional(), radiusTop: z.number().finite().min(0).max(100).optional(),
  radiusBottom: z.number().finite().min(0).max(100).optional(),
  tube: dimension.optional(), radialSegments: z.number().int().min(3).max(128).optional(),
  widthSegments: z.number().int().min(3).max(128).optional(),
  heightSegments: z.number().int().min(1).max(128).optional(),
  tubularSegments: z.number().int().min(3).max(128).optional(),
  detail: z.number().int().min(0).max(4).optional(),
}).strict();
const primitiveOptionKeys: Record<string, readonly string[]> = {
  box: ["width", "height", "depth"],
  plane: ["width", "height"],
  sphere: ["radius", "widthSegments", "heightSegments"],
  cylinder: ["radiusTop", "radiusBottom", "height", "radialSegments", "heightSegments"],
  cone: ["radius", "height", "radialSegments", "heightSegments"],
  torus: ["radius", "tube", "radialSegments", "tubularSegments"],
  tetrahedron: ["radius", "detail"], octahedron: ["radius", "detail"], icosahedron: ["radius", "detail"],
};

/**
 * Editor commands are a closed, discriminated union. The agent can only ask for
 * these operations; it never sends code or free-form instructions to the editor.
 */
export const editorCommandSchema = z.discriminatedUnion("type", [
  z.object({ ...commandBase, type: z.literal("scene.duplicate_hierarchy"), sourceId: identifierSchema,
    copies: z.array(z.object({ objectId: identifierSchema, name: nameSchema.optional(),
      descendants: z.array(z.object({ sourceId: identifierSchema, objectId: identifierSchema }).strict()).max(1999),
    }).strict()).min(1).max(63),
    offset: vector3.refine((values) => values.every((value) => Math.abs(value) <= 100000)),
    space: z.enum(["parent", "world"]).default("parent"),
  }).strict().refine((command) => {
    const ids = command.copies.flatMap((copy) => [copy.objectId, ...copy.descendants.map((entry) => entry.objectId)]);
    return ids.length <= 2000 && new Set(ids).size === ids.length && command.copies.every((copy) => new Set(copy.descendants.map((entry) => entry.sourceId)).size === copy.descendants.length);
  }, "Use unique new IDs and one mapping per descendant, with at most 2000 new objects"),
  z.object({ ...baseEdit, type: z.literal("material.assign"), slot: z.number().int().min(0).max(255),
    ids: z.array(vertexId).min(1).max(4096).refine((ids) => new Set(ids).size === ids.length, "Face IDs must be unique").optional(),
  }).strict(),
  z.object({ ...commandBase, type: z.literal("material.set_properties"), objectId: identifierSchema, meshPath: meshPathSchema.default([]),
    slot: z.number().int().min(0).max(255), properties: materialPropertiesSchema.refine((value) => Object.keys(value).length > 0, "Specify material properties"),
  }).strict(),
  z.object({ ...commandBase, type: z.literal("material.add_slot"), objectId: identifierSchema, meshPath: meshPathSchema.default([]),
    slot: z.number().int().min(0).max(255), properties: materialPropertiesSchema.default({}),
  }).strict(),
  z.object({ ...commandBase, type: z.literal("material.replace_slot"), objectId: identifierSchema, meshPath: meshPathSchema.default([]),
    slot: z.number().int().min(0).max(255), properties: materialPropertiesSchema.default({}),
  }).strict(),
  z.object({ ...baseEdit, type: z.literal("geometry.bisect"), plane: cutPlane,
    space: z.enum(["local", "world"]).default("local"),
    ids: uniqueFaces.optional(),
    keep: z.enum(["both", "positive", "negative"]).default("both"),
    fill: z.boolean().default(false),
    snapDistance: z.number().finite().positive().max(100).optional(),
  }).strict()
    .refine((command) => !command.fill || command.keep !== "both", "Fill closes the opening that keep positive or negative leaves; use it only with keep")
    .refine((command) => command.ids === undefined || command.keep === "both", "Keeping one side removes whole sides, so it cannot be limited to ids"),
  z.object({ ...baseEdit, type: z.literal("geometry.delete_components"), kind: z.enum(["face", "edge", "vertex"]),
    ids: z.array(z.string().regex(/^(0|[1-9]\d{0,9})(_(0|[1-9]\d{0,9}))?$/)).min(1).max(4096)
      .refine((ids) => new Set(ids).size === ids.length, "Component IDs must be unique"),
  }).strict().refine((command) => command.ids.every((id) => command.kind === "edge" ?
    id.includes("_") && Number(id.split("_")[0]) < Number(id.split("_")[1]) : !id.includes("_")), "Use face or vertex IDs, or canonical edge IDs, matching kind"),
  z.object({ ...baseEdit, type: z.literal("geometry.bridge_edge_loops"),
    ids: z.array(edgeId).min(6).max(512).refine((ids) => new Set(ids).size === ids.length, "Edge IDs must be unique"),
    twist: z.number().int().min(-256).max(256).default(0),
  }).strict(),
  z.object({ ...baseEdit, type: z.literal("geometry.separate_faces"), ids: uniqueFaces, newObjectId: identifierSchema, name: nameSchema.optional() }).strict()
    .refine((command) => command.meshPath.length === 0, "Separate faces of a whole object: leave meshPath empty")
    .refine((command) => command.newObjectId !== command.objectId, "newObjectId must be a fresh ID, not the object being split"),
  z.object({ ...baseEdit, type: z.literal("geometry.set_shading"), mode: z.enum(["flat", "smooth"]),
    angle: z.number().finite().gt(0).lt(180).optional(),
  }).strict().refine((command) => command.angle === undefined || command.mode === "smooth", "An angle applies to smooth shading only"),
  z.object({ ...baseEdit, type: z.literal("geometry.flip_normals"), ids: uniqueFaces.optional() }).strict(),
  z.object({ ...baseEdit, type: z.literal("geometry.triangulate_faces"), ids: uniqueFaces.optional() }).strict(),
  z.object({ ...baseEdit, type: z.literal("geometry.knife_path"), segments: z.array(knifeSegment).min(1).max(64) }).strict(),
  z.object({ ...baseEdit, type: z.literal("geometry.knife_chord"), ...knifeSegment.shape }).strict().refine((command) => !("edge" in command.start && "edge" in command.end && command.start.edge === command.end.edge) && !("vertex" in command.start && "vertex" in command.end && command.start.vertex === command.end.vertex), "Cut endpoints must be distinct"),
  z.object({ ...baseEdit, type: z.literal("geometry.correct_normals"), mode: z.enum(["consistent", "outward"]).default("consistent") }).strict(),
  z.object({ ...baseEdit, type: z.literal("geometry.remove_duplicate_faces") }).strict(),
  z.object({ ...baseEdit, type: z.literal("geometry.merge_by_distance"), ids: uniqueVertices, distance: z.number().finite().positive().max(100) }).strict(),
  z.object({ ...baseEdit, type: z.literal("geometry.merge_vertices"), ids: uniqueVertices, mode: z.enum(["center", "first", "last"]).default("center") }).strict(),
  z.object({ ...baseEdit, type: z.literal("geometry.dissolve_edges"), ids: uniqueEdges }).strict(),
  z.object({ ...baseEdit, type: z.literal("geometry.slide_edges"), ids: uniqueEdges,
    rails: z.array(z.object({ vertex: vertexId, toward: vertexId }).strict()).min(2).max(8192)
      .refine((rails) => new Set(rails.map((rail) => rail.vertex)).size === rails.length, "Rail vertices must be unique"),
    factor: z.number().finite().gt(0).lt(1),
  }).strict(),
  z.object({ ...baseEdit, type: z.literal("geometry.loop_cut"), edge: edgeId, cuts: z.number().int().min(1).max(16).default(1),
    factor: z.number().finite().gt(0).lt(1).default(0.5),
  }).strict().refine((command) => command.cuts === 1 || command.factor === 0.5, "Multiple cuts use even spacing"),
  z.object({
    ...commandBase, type: z.literal("geometry.transform_components"), objectId: identifierSchema,
    meshPath: meshPathSchema.default([]), kind: z.enum(["vertex", "edge"]),
    ids: z.array(z.string().regex(/^(0|[1-9]\d{0,9})(_(0|[1-9]\d{0,9}))?$/)).min(1).max(4096)
      .refine((ids) => new Set(ids).size === ids.length, "Component IDs must be unique"),
    componentView: z.literal("base").default("base"),
    space: z.enum(["local", "world"]).default("local"),
    pivot: vector3.optional(),
    transform: transformSchema.refine(({ position, rotation, scale }) => Boolean(position || rotation || scale) &&
      (scale === undefined || scale.every((value) => value >= 0.001 && value <= 100)),
    "Specify a translation, rotation or positive scale in the range 0.001–100"),
  }).strict().refine((command) => command.ids.every((id) => command.kind === "vertex" ? !id.includes("_") :
    id.includes("_") && Number(id.split("_")[0]) < Number(id.split("_")[1])), "Use vertex IDs or canonical edge IDs matching kind"),
  z.object({ ...commandBase, type: z.literal("geometry.bevel"), objectId: identifierSchema,
    meshPath: meshPathSchema.default([]), width: z.number().finite().positive().max(100),
    segments: z.number().int().min(1).max(8).optional(),
    profile: bevelProfileSchema.optional(),
    angle: z.number().finite().min(0).max(180).optional(),
  }).strict(),
  z.object({ ...commandBase, type: z.literal("geometry.bevel_edges"), objectId: identifierSchema,
    meshPath: meshPathSchema.default([]),
    ids: z.array(z.string().regex(/^\d{1,10}_\d{1,10}$/)).min(1).max(4096),
    width: z.number().finite().positive().max(100),
    segments: z.number().int().min(1).max(MAX_SELECTED_BEVEL_SEGMENTS),
    profile: bevelProfileSchema,
    trimEndFaces: z.boolean().optional(),
  }).strict().refine(({ ids }) => new Set(ids).size === ids.length && ids.every((id) => {
    const [a, b] = id.split("_"); return Number(a) < Number(b);
  }), "Use distinct canonical edge IDs"),
  z.object({ ...commandBase, type: z.literal("geometry.set_modifiers"), objectId: identifierSchema,
    meshPath: meshPathSchema.default([]), modifiers: modifierListSchema,
  }).strict(),
  z.object({
    ...commandBase, type: z.literal("geometry.boolean"), objectId: identifierSchema,
    meshPath: meshPathSchema.default([]), ...booleanOperandFields,
  }).strict(),
  z.object({
    ...commandBase,
    type: z.literal("geometry.extrude"),
    objectId: identifierSchema,
    meshPath: meshPathSchema.default([]),
    kind: z.enum(["vertex", "edge", "face"]),
    ids: z.array(z.string().regex(/^\d{1,10}(_\d{1,10})?$/)).min(1).max(4096),
    componentView: z.literal("base").optional(),
    offset: vector3.optional(),
    normalDistance: z.number().finite().optional(),
    steps: z.number().int().min(1).max(16).optional(),
    ...extrusionShapeFields,
  }).strict()
    .refine((command) => (command.offset === undefined) !== (command.normalDistance === undefined), {
      message: "Provide exactly one of offset or normalDistance",
    })
    .refine((command) => command.normalDistance === undefined ||
      (command.kind === "face" && Math.abs(command.normalDistance) > 1e-6), {
      path: ["normalDistance"],
      message: "Normal extrusion needs a face selection and a nonzero mesh-local distance",
    })
    .refine((command) => command.offset === undefined || command.offset.reduce((sum, value) => sum + value * value, 0) > 1e-12, {
      path: ["offset"], message: "Extrude offset must move the selection",
    })
    .refine(validExtrusionShape, {
      message: "Use face-only shaping, one cap scale mode, and region-normal extrusion to close an open surface",
    })
    .refine((command) => (command.steps ?? 1) === 1 || (command.kind === "face" && !command.closeOpenSurface), {
      message: "Repeat extrusion requires faces and cannot close a sheet",
    }),
  z.object({
    ...commandBase,
    type: z.literal("geometry.transform_faces"),
    objectId: identifierSchema,
    meshPath: meshPathSchema.default([]),
    ids: z.array(z.string().regex(/^\d{1,10}$/)).min(1).max(4096),
    componentView: z.literal("base").optional(),
    space: z.enum(["local", "world"]).default("local"),
    transform: transformSchema.refine(
      ({ position, rotation, scale }) => Boolean(position || rotation || scale) &&
        (scale === undefined || scale.every((value) => value >= 0.001 && value <= 100)),
      "Specify a translation, rotation or positive scale in the range 0.001–100",
    ),
  }).strict(),
  z.object({
    ...commandBase,
    type: z.literal("geometry.fill_hole"),
    objectId: identifierSchema,
    meshPath: meshPathSchema.default([]),
    componentView: z.literal("base").optional(),
    ids: z.array(z.string().regex(/^\d{1,10}_\d{1,10}$/)).min(3).max(256),
  }).strict(),
  z.object({
    ...commandBase,
    type: z.literal("geometry.inset_faces"),
    objectId: identifierSchema,
    meshPath: meshPathSchema.default([]),
    ids: z.array(z.string().regex(/^\d{1,10}$/)).min(1).max(4096),
    thickness: z.number().finite().nonnegative(),
    depth: z.number().finite().optional(),
    boundary: z.boolean().optional(),
    offsetEven: z.boolean().optional(),
    offsetRelative: z.boolean().optional(),
    edgeRail: z.boolean().optional(),
    outset: z.boolean().optional(),
    individual: z.boolean().optional(),
    selectOuter: z.boolean().optional(),
    interpolate: z.boolean().optional(),
  }).strict()
    .refine((command) => command.thickness > 0 || Boolean(command.depth), "Inset needs a nonzero thickness or depth")
    .refine((command) => !command.individual || !command.outset, "Outset is available in region mode"),
  z.object({
    ...commandBase,
    type: z.literal("geometry.subdivide_faces"),
    objectId: identifierSchema,
    meshPath: meshPathSchema.default([]),
    ids: z.array(z.string().regex(/^\d{1,10}$/)).min(1).max(4096),
  }).strict(),
  z.object({ ...commandBase, type: z.literal("geometry.subdivide"), objectId: identifierSchema,
    meshPath: meshPathSchema.default([]), levels: z.number().int().min(1).max(3),
    method: subdivisionMethodSchema.optional(),
  }).strict(),
  z.object({
    ...commandBase, type: z.literal("geometry.create_mesh"), objectId: identifierSchema,
    name: nameSchema.optional(),
    /** The parent to create the mesh under. Left out, the mesh is created at the top level. */
    parentId: identifierSchema.optional(),
    /** The collection to put the mesh in. Left out, it joins its parent's collection, or the scene itself. */
    collectionId: identifierSchema.optional(),
    /** Where the mesh starts, local to its parent. */
    transform: transformSchema.optional(),
    shading: z.enum(["flat", "smooth"]).optional(),
    vertices: z.array(vector3.refine((point) => point.every((value) => Math.abs(value) <= 10000), "Vertex coordinates must be within ±10000")).min(3).max(4096),
    faces: z.array(z.array(z.number().int().nonnegative()).min(3).max(64)).min(1).max(4096),
  }).strict()
    .refine((command) => command.faces.reduce((count, face) => count + face.length - 2, 0) <= MAX_MESH_INPUT_TRIANGLES, "Mesh exceeds the editable triangle limit")
    .refine((command) => command.faces.every((face) => new Set(face).size === face.length && face.every((index) => index < command.vertices.length)), "Face indices must be distinct and reference existing vertices")
    .refine((command) => new Set(command.faces.flat()).size === command.vertices.length, "Every vertex must be used by a face"),
  z
    .object({
      ...commandBase,
      type: z.literal("scene.create_object"),
      objectId: identifierSchema,
      name: nameSchema,
      parentId: identifierSchema.optional(),
      /** The collection to put the object in. Left out, it joins its parent's collection, or the scene itself. */
      collectionId: identifierSchema.optional(),
      transform: transformSchema.optional(),
    })
    .strict(),
  z
    .object({
      ...commandBase,
      type: z.literal("scene.transform_object"),
      objectId: identifierSchema,
      transform: transformSchema,
    })
    .strict(),
  z
    .object({
      ...commandBase,
      type: z.literal("scene.move_object"),
      objectId: identifierSchema,
      /**
       * How far to move the object along its parent's axes, added to where it is when the command runs. Unlike
       * scene.transform_object, which sets a position, this keeps a move the user made in between.
       */
      delta: vector3,
    })
    .strict()
    .refine((command) => command.delta.some((value) => value !== 0), "A move must change the position")
    .refine((command) => command.delta.every((value) => Math.abs(value) <= 100000), "A move can be at most 100000 units along an axis"),
  z
    .object({
      ...commandBase,
      type: z.literal("scene.delete_object"),
      objectId: identifierSchema,
    })
    .strict(),
  z
    .object({
      ...commandBase,
      type: z.literal("geometry.create_primitive"),
      objectId: identifierSchema,
      primitive: z.enum(["box", "sphere", "cylinder", "plane", "cone", "torus", "tetrahedron", "octahedron", "icosahedron"]),
      size: z.number().positive().max(100),
      options: primitiveOptions.optional(),
      replaceExisting: z.boolean().default(false),
      /** A label. The kind of shape when left out. A taken name among the same parent's children gets a number. */
      name: nameSchema.optional(),
      /** The parent to create the shape under. Left out, the shape is created at the top level. */
      parentId: identifierSchema.optional(),
      /** The collection to put the shape in. Left out, it joins its parent's collection, or the scene itself. */
      collectionId: identifierSchema.optional(),
      /** Where the shape starts, local to its parent. */
      transform: transformSchema.optional(),
    })
    .strict()
    .refine((command) => !command.replaceExisting || (command.name === undefined && command.parentId === undefined && command.collectionId === undefined && command.transform === undefined), "Replacing a shape keeps the object's name, parent, collection and place; leave name, parentId, collectionId and transform out, or create a new object")
    .refine((command) => Object.keys(command.options ?? {}).every((key) => primitiveOptionKeys[command.primitive]?.includes(key)), "Primitive options do not apply to this shape")
    .refine((command) => command.primitive !== "cylinder" || (command.options?.radiusTop ?? command.size / 2) > 0 || (command.options?.radiusBottom ?? command.size / 2) > 0, "A cylinder needs at least one nonzero radius")
    .refine((command) => command.primitive !== "torus" || (command.options?.tube ?? command.size * 0.15) < (command.options?.radius ?? command.size * 0.35), "Torus tube must be smaller than its ring radius")
    .refine((command) => command.primitive !== "sphere" || (command.options?.heightSegments ?? 16) >= 2, "A sphere needs at least two height segments")
    .refine((command) => {
      const options = command.options;
      if (command.primitive === "sphere") return 2 * (options?.widthSegments ?? 24) * ((options?.heightSegments ?? 16) - 1) <= MAX_MESH_INPUT_TRIANGLES;
      if (command.primitive === "cylinder" || command.primitive === "cone") return 2 * (options?.radialSegments ?? 24) * ((options?.heightSegments ?? 1) + 1) <= MAX_MESH_INPUT_TRIANGLES;
      if (command.primitive === "torus") return 2 * (options?.radialSegments ?? 12) * (options?.tubularSegments ?? 32) <= MAX_MESH_INPUT_TRIANGLES;
      return true;
    }, "Primitive exceeds the editable mesh triangle limit. Reduce its segments."),
  z
    .object({
      ...commandBase,
      type: z.literal("scene.rename_object"),
      objectId: identifierSchema,
      name: nameSchema,
    })
    .strict(),
  z
    .object({
      ...commandBase,
      type: z.literal("scene.set_visibility"),
      objectId: identifierSchema,
      visible: z.boolean(),
    })
    .strict(),
  z
    .object({
      ...commandBase,
      type: z.literal("scene.set_parent"),
      objectId: identifierSchema,
      /** The new parent, or null to move the object to the top level. The object keeps its place in the world. */
      parentId: identifierSchema.nullable(),
    })
    .strict(),
  z
    .object({
      ...commandBase,
      type: z.literal("scene.create_collection"),
      collectionId: identifierSchema,
      name: nameSchema,
      /** The collection to make it inside, or left out for the top. */
      parentCollectionId: identifierSchema.optional(),
    })
    .strict(),
  z.object({ ...commandBase, type: z.literal("scene.rename_collection"), collectionId: identifierSchema, name: nameSchema }).strict(),
  z.object({ ...commandBase, type: z.literal("scene.set_collection_visibility"), collectionId: identifierSchema, visible: z.boolean() }).strict(),
  z
    .object({
      ...commandBase,
      type: z.literal("scene.move_collection"),
      collectionId: identifierSchema,
      /** The collection to put it inside, or null for the top. */
      parentCollectionId: identifierSchema.nullable(),
    })
    .strict(),
  z.object({ ...commandBase, type: z.literal("scene.delete_collection"), collectionId: identifierSchema }).strict(),
  z
    .object({
      ...commandBase,
      type: z.literal("scene.move_to_collection"),
      objectId: identifierSchema,
      /** The collection to put the object in, or null for the scene itself. Nothing moves in space. */
      collectionId: identifierSchema.nullable(),
      /** Whether the objects that hang below the object (its children, and theirs) go with it. Defaults to true. */
      includeChildren: z.boolean().default(true),
    })
    .strict(),
]);

export const editorCommandListSchema = z.array(editorCommandSchema).min(1).max(MAX_COMMANDS_PER_PROPOSAL);

/** One command as a type. */
export type EditorCommand = z.infer<typeof editorCommandSchema>;
/** The kind of a command, such as "geometry.bevel_edges". */
export type EditorCommandType = EditorCommand["type"];
