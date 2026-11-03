import { z } from "zod";
import { identifierSchema } from "./editor-command.schema.js";

/** The most views one capture may ask for. */
export const MAX_CAPTURE_VIEWS = 6;
/** The smallest and largest side, in pixels, of a captured image. */
export const MIN_CAPTURE_SIDE = 128;
export const MAX_CAPTURE_SIDE = 1024;
/** The most objects one capture may focus on or highlight. */
export const MAX_CAPTURE_OBJECTS = 50;
/** The most objects listed with each image. */
export const MAX_LISTED_OBJECTS = 60;
/** The longest base64 text of one image the editor may send. */
export const MAX_IMAGE_BASE64_LENGTH = 2_000_000;

export const VIEW_PRESETS = ["current", "front", "back", "left", "right", "top", "bottom", "isometric"] as const;
export const CAPTURE_MODES = ["solid", "wireframe", "normals"] as const;
export const PROJECTIONS = ["perspective", "orthographic"] as const;

// A fixed-length array rather than z.tuple: tuples become `items: [...]` in JSON Schema, which model
// providers reject when this schema is sent as a tool definition.
const vector3 = z.array(z.number().finite()).length(3);

/**
 * One point of view. The camera comes from `camera` if given, else from `orbit`, else from `preset`
 * (default "isometric"). Presets and orbits circle the focused objects, or the whole scene, and frame them.
 */
export const viewSpecSchema = z
  .object({
    label: z.string().min(1).max(60).optional(),
    preset: z.enum(VIEW_PRESETS).optional(),
    orbit: z
      .object({
        azimuthDegrees: z.number().min(-360).max(360),
        elevationDegrees: z.number().min(-90).max(90),
      })
      .strict()
      .optional(),
    camera: z
      .object({ position: vector3, target: vector3, fov: z.number().min(10).max(120).optional() })
      .strict()
      .optional(),
    projection: z.enum(PROJECTIONS).optional(),
    zoom: z.number().min(0.25).max(20).optional(),
  })
  .strict();

/** What the assistant may ask the editor to draw. */
export const viewCaptureRequestSchema = z
  .object({
    views: z.array(viewSpecSchema).min(1).max(MAX_CAPTURE_VIEWS),
    focus: z.array(identifierSchema).max(MAX_CAPTURE_OBJECTS).optional(),
    highlight: z.array(identifierSchema).max(MAX_CAPTURE_OBJECTS).optional(),
    isolate: z.boolean().optional(),
    mode: z.enum(CAPTURE_MODES).optional(),
    guides: z.boolean().optional(),
    labels: z.boolean().optional(),
    width: z.number().int().min(MIN_CAPTURE_SIDE).max(MAX_CAPTURE_SIDE).optional(),
    height: z.number().int().min(MIN_CAPTURE_SIDE).max(MAX_CAPTURE_SIDE).optional(),
  })
  .strict();

const boundsSchema = z.object({ min: vector3, max: vector3 }).strict();

const screenRectSchema = z
  .object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() })
  .strict();

const capturedObjectSchema = z
  .object({
    id: identifierSchema,
    name: z.string().max(120),
    /** The object's bounding box projected into the image, in pixels. Not a visibility test. */
    screenBounds: screenRectSchema.nullable(),
    /** Whether any part of the bounding box is inside the image. */
    inFrame: z.boolean(),
  })
  .strict();

const capturedImageSchema = z
  .object({
    label: z.string().max(60),
    mediaType: z.literal("image/jpeg"),
    /** Base64 text of the image, without a data: prefix. Empty when the request asked for no images. */
    data: z.string().max(MAX_IMAGE_BASE64_LENGTH),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    camera: z
      .object({
        projection: z.enum(PROJECTIONS),
        position: vector3,
        target: vector3,
        fov: z.number().nullable(),
        orthographicHeight: z.number().nullable(),
      })
      .strict(),
    objects: z.array(capturedObjectSchema).max(MAX_LISTED_OBJECTS),
  })
  .strict();

const focusedObjectSchema = z
  .object({
    id: identifierSchema,
    name: z.string().max(120),
    bounds: boundsSchema.nullable(),
    size: vector3.nullable(),
    center: vector3.nullable(),
  })
  .strict();

/** What the editor drew, with where everything is, so pixels can be tied back to object ids. */
export const viewCaptureResultSchema = z
  .object({
    images: z.array(capturedImageSchema).min(1).max(MAX_CAPTURE_VIEWS),
    scene: z.object({ objectCount: z.number().int().nonnegative(), bounds: boundsSchema.nullable() }).strict(),
    focus: z.array(focusedObjectSchema).max(MAX_CAPTURE_OBJECTS),
    missingIds: z.array(identifierSchema).max(MAX_CAPTURE_OBJECTS * 2),
  })
  .strict();

export type ViewSpec = z.infer<typeof viewSpecSchema>;
export type ViewCaptureRequest = z.infer<typeof viewCaptureRequestSchema>;
export type ViewCaptureResult = z.infer<typeof viewCaptureResultSchema>;
export type CapturedImage = z.infer<typeof capturedImageSchema>;
export type CapturedObject = z.infer<typeof capturedObjectSchema>;
