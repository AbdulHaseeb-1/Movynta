import { z } from "zod";
import { MAX_MESH_INPUT_TRIANGLES, meshPathSchema } from "./mesh.schema.js";
import { bevelProfileSchema, booleanOperandFields, extrusionShapeFields, modifierListSchema, subdivisionMethodSchema, validExtrusionShape } from "./modifier.schema.js";

/** Upper bound for commands in one proposal. Larger batches always require approval. */
export const MAX_COMMANDS_PER_PROPOSAL = 200;

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
  z.object({ ...commandBase, type: z.literal("geometry.bevel"), objectId: identifierSchema,
    meshPath: meshPathSchema.default([]), width: z.number().finite().positive().max(100),
    segments: z.number().int().min(1).max(8).optional(),
    profile: bevelProfileSchema.optional(),
    angle: z.number().finite().min(0).max(180).optional(),
  }).strict(),
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
      /** Where the shape starts, local to its parent. */
      transform: transformSchema.optional(),
    })
    .strict()
    .refine((command) => !command.replaceExisting || (command.name === undefined && command.parentId === undefined && command.transform === undefined), "Replacing a shape keeps the object's name, parent and place; leave name, parentId and transform out, or create a new object")
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
]);

export const editorCommandListSchema = z.array(editorCommandSchema).min(1).max(MAX_COMMANDS_PER_PROPOSAL);
