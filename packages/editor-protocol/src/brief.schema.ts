import { z } from "zod";

const identifier = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const axisSchema = z.enum(["x", "y", "z"]);
const label = z.string().trim().min(1).max(120).optional();
const bound = z.number().finite().min(-1e9).max(1e9);

/**
 * Names the object a check is about: by id, by its exact name, or (for `count` only) by the start of a name such
 * as "Leg" for Leg, Leg.001 and Leg.002. Names are matched without regard to letter case. Exactly one field.
 */
export const briefSelectorSchema = z
  .object({
    id: identifier.optional(),
    name: z.string().trim().min(1).max(120).optional(),
    namePrefix: z.string().trim().min(1).max(120).optional(),
  })
  .strict()
  .refine(
    (selector) => [selector.id, selector.name, selector.namePrefix].filter((field) => field !== undefined).length === 1,
    "Give exactly one of id, name or namePrefix",
  );
export type BriefSelector = z.infer<typeof briefSelectorSchema>;

/** A selector for checks about one object: a prefix could match several, so it is not offered. */
const singleSelectorSchema = briefSelectorSchema.refine(
  (selector) => selector.namePrefix === undefined,
  "namePrefix is only for count checks; use id or name",
);

const limits = (check: { min?: number | undefined; max?: number | undefined }) =>
  (check.min !== undefined || check.max !== undefined) &&
  (check.min === undefined || check.max === undefined || check.min <= check.max);
const LIMITS_MESSAGE = "Give min, max or both, with min not above max";

/**
 * One measurable statement about the finished scene. Numbers are scene units, measured on world-space bounds
 * (which include a group's descendants), so a check on a group is a check on the whole assembled thing.
 */
export const briefCheckSchema = z.discriminatedUnion("kind", [
  /** How many objects match: at least `min` (default 1) and, when given, at most `max`. */
  z
    .object({
      kind: z.literal("count"),
      label,
      selector: briefSelectorSchema,
      min: z.number().int().min(0).max(1000).optional(),
      max: z.number().int().min(0).max(1000).optional(),
    })
    .strict()
    .refine(
      (check) => check.min === undefined || check.max === undefined || check.min <= check.max,
      "min must not be above max",
    ),
  /** The extent of one object along an axis: for example a seat no wider than 0.5. */
  z
    .object({
      kind: z.literal("size"),
      label,
      target: singleSelectorSchema,
      axis: axisSchema,
      min: bound.optional(),
      max: bound.optional(),
    })
    .strict()
    .refine(limits, LIMITS_MESSAGE),
  /** Where the low edge, middle or high edge of one object lies on an axis: for example its lowest point on the floor. */
  z
    .object({
      kind: z.literal("position"),
      label,
      target: singleSelectorSchema,
      axis: axisSchema,
      anchor: z.enum(["min", "center", "max"]),
      min: bound.optional(),
      max: bound.optional(),
    })
    .strict()
    .refine(limits, LIMITS_MESSAGE),
  /** The space from the high edge of `first` to the low edge of `second` on an axis (negative when they overlap): 0 means touching. */
  z
    .object({
      kind: z.literal("gap"),
      label,
      first: singleSelectorSchema,
      second: singleSelectorSchema,
      axis: axisSchema,
      min: bound.optional(),
      max: bound.optional(),
    })
    .strict()
    .refine(limits, LIMITS_MESSAGE),
  /** `second` mirrors `first` across the plane where `axis` equals `planeAt` (default 0), within `tolerance`. */
  z
    .object({
      kind: z.literal("symmetric"),
      label,
      first: singleSelectorSchema,
      second: singleSelectorSchema,
      axis: axisSchema,
      planeAt: bound.optional(),
      tolerance: z.number().finite().positive().max(1e6).optional(),
    })
    .strict(),
  /** The centers of the two objects are at the same place on an axis, within `tolerance`. */
  z
    .object({
      kind: z.literal("aligned"),
      label,
      first: singleSelectorSchema,
      second: singleSelectorSchema,
      axis: axisSchema,
      tolerance: z.number().finite().positive().max(1e6).optional(),
    })
    .strict(),
  /** Every part under `group` touches the rest through other parts, within `tolerance`: nothing floats or has come loose. */
  z
    .object({
      kind: z.literal("connected"),
      label,
      group: singleSelectorSchema,
      tolerance: z.number().finite().min(0).max(1e6).optional(),
    })
    .strict(),
  /** `inner` lies inside `outer` on every axis, within `tolerance`: an eye in a head, a handle on its door. */
  z
    .object({
      kind: z.literal("contained"),
      label,
      inner: singleSelectorSchema,
      outer: singleSelectorSchema,
      tolerance: z.number().finite().min(0).max(1e6).optional(),
    })
    .strict(),
]);
export type BriefCheck = z.infer<typeof briefCheckSchema>;

/**
 * What the finished work must be, written down before building: the subject, the assumptions made where the user
 * gave no detail, and checks that code can pass or fail. It is how "done" is decided, instead of a feeling.
 */
export const briefSchema = z
  .object({
    subject: z.string().trim().min(1).max(200),
    style: z.string().trim().max(200).optional(),
    assumptions: z.array(z.string().trim().min(1).max(200)).max(8).default([]),
    checks: z.array(briefCheckSchema).min(1).max(40),
  })
  .strict();
export type Brief = z.infer<typeof briefSchema>;

export type BriefCheckStatus = "pass" | "fail" | "unresolved";

export interface BriefCheckResult {
  readonly index: number;
  readonly label: string;
  readonly kind: BriefCheck["kind"];
  /** `unresolved` means the check could not be measured: an object is missing, ambiguous or has no geometry. */
  readonly status: BriefCheckStatus;
  readonly measured: string;
  readonly expected: string;
}

export interface BriefEvaluation {
  /** The scene revision the checks were measured on. */
  readonly revision: number;
  /** False when the editor reported no bounds at all, so nothing could be measured (an older editor). */
  readonly measurable: boolean;
  readonly passed: number;
  readonly failed: number;
  readonly unresolved: number;
  readonly results: readonly BriefCheckResult[];
}
