import { editorContextSchema } from "@movynta/editor-protocol";
import { z } from "zod";

/** The tool types, one tab each. They follow the permissions declared in `TOOL_PERMISSIONS` (modules/tools/tool.types.ts). */
export const assistantToolTypeSchema = z.enum(["read", "plan", "propose", "apply", "skill"]);
/** The type of an assistant tool: read, plan, propose, apply or skill. */
export type AssistantToolType = z.infer<typeof assistantToolTypeSchema>;

const inputRowSchema = z.object({
  name: z.string().min(1),
  type: z.string().min(1),
  required: z.boolean().optional(),
  default: z.string().optional(),
  meaning: z.string().min(1),
});

const resultRowSchema = z.object({
  field: z.string().min(1),
  meaning: z.string().min(1),
});

const detailSectionSchema = z.object({
  title: z.string().min(1),
  rows: z.array(z.object({ label: z.string().min(1), meaning: z.string().min(1) })).min(1),
});

const point2dSchema = z.object({
  label: z.string().min(1),
  x0: z.number(),
  x1: z.number(),
  z0: z.number(),
  z1: z.number(),
  tone: z.enum(["solid", "ghost", "new"]),
});

const side2dSchema = z.object({
  label: z.string().min(1),
  x0: z.number(),
  x1: z.number(),
  y0: z.number(),
  y1: z.number(),
  tone: z.enum(["solid", "ghost", "new"]),
});

/** The picture shown beside a tool. Each kind is drawn by one component, from the data in this file. */
export const assistantToolVisualSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("tree"), caption: z.string().optional() }),
  z.object({
    kind: z.literal("counts"),
    caption: z.string().optional(),
    counts: z.array(z.object({ label: z.string().min(1), value: z.number().int().nonnegative() })),
    selected: z.array(z.string()),
  }),
  z.object({
    kind: z.literal("mesh"),
    caption: z.string().optional(),
    vertices: z.array(z.array(z.number()).length(3)),
    faces: z.array(z.array(z.number().int().nonnegative())),
    highlight: z.array(z.number().int().nonnegative()),
  }),
  z.object({
    kind: z.literal("swatch"),
    caption: z.string().optional(),
    name: z.string().min(1),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    meta: z.string(),
    meters: z.array(z.object({ label: z.string().min(1), value: z.number() })),
    textures: z.array(z.string()),
  }),
  z.object({
    kind: z.literal("frames"),
    caption: z.string().optional(),
    views: z.array(
      z.object({
        label: z.string().min(1),
        projection: z.string().min(1),
        width: z.number().positive(),
        height: z.number().positive(),
        boxes: z.array(
          z.object({
            name: z.string().min(1),
            x: z.number(),
            y: z.number(),
            width: z.number().nonnegative(),
            height: z.number().nonnegative(),
          }),
        ),
      }),
    ),
  }),
  z.object({
    kind: z.literal("issues"),
    caption: z.string().optional(),
    ok: z.boolean(),
    objectCount: z.number().int().nonnegative(),
    issues: z.array(
      z.object({
        severity: z.enum(["error", "warning", "info"]),
        objectId: z.string().nullable(),
        message: z.string().min(1),
      }),
    ),
  }),
  z.object({
    kind: z.literal("top-view"),
    caption: z.string().optional(),
    boxes: z.array(point2dSchema).min(1),
    gap: z.object({ x0: z.number(), x1: z.number(), label: z.string().min(1) }).optional(),
  }),
  z.object({
    kind: z.literal("side-view"),
    caption: z.string().optional(),
    ground: z.number(),
    boxes: z.array(side2dSchema).min(1),
    guide: z.object({ y: z.number(), label: z.string().min(1) }).optional(),
  }),
  z.object({
    kind: z.literal("steps"),
    caption: z.string().optional(),
    goal: z.string().min(1),
    dimension: z.string().min(1),
    steps: z.array(z.object({ title: z.string().min(1), tool: z.string().min(1), description: z.string() })).min(1),
  }),
  z.object({
    kind: z.literal("batch"),
    caption: z.string().optional(),
    rows: z.array(
      z.object({
        type: z.string().min(1),
        target: z.string(),
        detail: z.string(),
        tone: z.enum(["neutral", "ok"]).optional(),
      }),
    ),
    stages: z.array(
      z.object({ label: z.string().min(1), detail: z.string(), state: z.enum(["done", "current", "next"]) }),
    ),
  }),
  z.object({
    kind: z.literal("lists"),
    caption: z.string().optional(),
    groups: z
      .array(
        z.object({
          title: z.string().min(1),
          items: z.array(z.string()),
          tone: z.enum(["neutral", "ok", "warn"]),
        }),
      )
      .min(1),
  }),
]);
/** The picture shown beside a tool in the documentation. */
export type AssistantToolVisual = z.infer<typeof assistantToolVisualSchema>;

/** The schema for one tool's documentation entry. */
export const assistantToolSchema = z.object({
  name: z.string().regex(/^[a-z_]+\.[a-z_]+$/),
  type: assistantToolTypeSchema,
  /** Sections inside a tab, such as Inspect and Calculate under Read. */
  group: z.string().optional(),
  provider: z.string().min(1),
  permission: z.string().min(1),
  approval: z.string().min(1),
  needsEditor: z.boolean(),
  /** "code": the backend test runs the tool and compares the result. "live": only the shape is checked. */
  verify: z.enum(["code", "live"]),
  source: z.string().min(1),
  doc: z.string().min(1),
  summary: z.string().min(1),
  when: z.array(z.string().min(1)).min(1),
  input: z.object({ note: z.string().optional(), rows: z.array(inputRowSchema) }),
  details: z.array(detailSectionSchema).optional(),
  result: z.object({ note: z.string().optional(), rows: z.array(resultRowSchema) }),
  request: z.unknown(),
  /** The example result. "$scene" means the whole sample scene. */
  response: z.unknown(),
  flow: z.array(z.string().min(1)).optional(),
  visual: assistantToolVisualSchema,
  tips: z.array(z.string().min(1)),
  limits: z.array(z.string().min(1)),
  errors: z.array(z.object({ message: z.string().min(1), cause: z.string().min(1) })).optional(),
  related: z.array(z.string()),
});
/** One tool's documentation entry. */
export type AssistantTool = z.infer<typeof assistantToolSchema>;
/** One row of a tool's input table. */
export type AssistantToolInputRow = z.infer<typeof inputRowSchema>;
/** One row of a tool's result table. */
export type AssistantToolResultRow = z.infer<typeof resultRowSchema>;
/** A section of a tool's documentation with its own rows. */
export type AssistantToolDetail = z.infer<typeof detailSectionSchema>;

/** The schema for the whole assistant tools document. */
export const assistantToolDocumentSchema = z.object({
  intro: z.string().min(1),
  rules: z.array(z.string().min(1)).min(1),
  conventions: z.array(z.object({ term: z.string().min(1), meaning: z.string().min(1) })).min(1),
  types: z.array(z.object({ id: assistantToolTypeSchema, label: z.string().min(1), hint: z.string().min(1) })).min(1),
  scene: editorContextSchema,
  tools: z.array(assistantToolSchema).min(1),
});
/** The whole assistant tools document: its intro, rules and tools. */
export type AssistantToolDocument = z.infer<typeof assistantToolDocumentSchema>;
