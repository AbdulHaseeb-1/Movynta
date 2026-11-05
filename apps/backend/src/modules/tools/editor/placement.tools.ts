import { z } from "zod";
import { editorCommandListSchema, identifierSchema, lengthUnits, metersPerUnit, type MeasurementResult } from "@movynta/editor-protocol";
import type { EditorToolDependencies } from "./editor.types.js";
import { defineTool } from "../tool.types.js";

const ids = z.array(identifierSchema).min(1).max(50).refine((items) => new Set(items).size === items.length, "Object IDs must be unique");
const axis = z.enum(["x", "y", "z"]);
const anchor = z.enum(["min", "center", "max"]);
const scalar = z.number().finite().min(-100000).max(100000);
const point = z.array(z.number().finite()).length(3);
export const placementRequestSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("align"), objectIds: ids, referenceId: identifierSchema,
    axes: z.array(axis).min(1).max(3).refine((items) => new Set(items).size === items.length),
    sourceAnchor: anchor.default("center"), referenceAnchor: anchor.default("center") }).strict(),
  z.object({ kind: z.literal("gap"), objectIds: ids, referenceId: identifierSchema, axis,
    side: z.enum(["positive", "negative"]).default("positive"), gap: scalar,
    unit: z.enum(["scene", ...lengthUnits]).default("scene") }).strict(),
  z.object({ kind: z.literal("distribute"), objectIds: ids.refine((items) => items.length >= 3), axis,
    mode: z.enum(["centers", "gaps"]).default("gaps") }).strict(),
  z.object({ kind: z.literal("snap"), objectIds: ids.refine((items) => items.length === 1), from: point, to: point,
    expectedRevision: z.number().int().nonnegative() }).strict(),
]);
type Dimensions = Extract<Extract<MeasurementResult, { status: "ok" }>["data"], { kind: "dimensions" }>;
const axisIndex = { x: 0, y: 1, z: 2 } as const;
function coordinate(data: Dimensions, index: number, at: "min" | "center" | "max"): number {
  return (at === "center" ? data.center[index] : data.bounds[at][index]) ?? 0;
}

/** Calculates parent-local translations only; application still goes through the proposal transaction. */
export function createPlacementTool({ bridge, getUnits }: EditorToolDependencies) {
  return defineTool({
    name: "editor.plan_placement", permission: "read",
    description: "Plan precise world-axis placement from evaluated geometry including descendants. align matches min/center/max bounds on chosen axes to a reference. gap places each object's nearest bound at a signed gap on the positive or negative side of a reference; physical units require project calibration. distribute preserves the two endpoints and places intermediate objects in the given spatial order with equal centers or equal bounds gaps. snap translates one object so a world point from lands on world point to at expectedRevision. Returns scene.move_object commands and sourceRevision; propose with expectedRevision then apply. Nothing changes. Rejects ancestor/descendant targets, singular parents and mixed revisions. Bounds placement does not guarantee surface contact or collision freedom. Measure again after application, particularly with dependent Booleans.",
    parameters: z.object({ request: placementRequestSchema }).strict(),
    execute: async ({ request }, context) => {
      bridge.assertConnection(context.userId, context.projectId, context.clientId);
      const snapshot = await bridge.getContext(context.clientId);
      if (request.kind === "snap" && request.expectedRevision !== snapshot.revision) throw new Error("Scene changed; inspect the points again");
      const targets = [...request.objectIds, ...("referenceId" in request ? [request.referenceId] : [])];
      if (new Set(targets).size !== targets.length) throw new Error("Reference must be separate from moving objects");
      const selected = new Set(targets);
      const objects = new Map(snapshot.objects.map((object) => [object.id, object]));
      for (const id of targets) {
        const object = objects.get(id);
        if (!object) throw new Error(`Missing object ${id}`);
        const visited = new Set<string>();
        let parent = object.parentId;
        while (parent) {
          if (selected.has(parent)) throw new Error("Placement targets cannot contain ancestors and descendants");
          if (visited.has(parent)) throw new Error("Invalid parent cycle");
          visited.add(parent);
          parent = objects.get(parent)?.parentId ?? null;
        }
      }
      const dimensions = new Map<string, Dimensions>();
      for (const id of targets) {
        const measured = await bridge.getContext(context.clientId, undefined, { kind: "dimensions", target: { objectId: id }, space: "world" });
        if (measured.revision !== snapshot.revision) throw new Error("Scene changed while measuring; plan again");
        const result = measured.measurement;
        if (result?.status !== "ok" || result.data.kind !== "dimensions") throw new Error(result?.status === "unavailable" ? result.message : `Cannot measure ${id}`);
        dimensions.set(id, result.data);
      }
      const get = (id: string) => {
        const data = dimensions.get(id);
        if (!data) throw new Error(`Missing dimensions for ${id}`);
        return data;
      };
      const deltas = new Map(request.objectIds.map((id) => [id, [0, 0, 0]]));
      const setDelta = (id: string, index: number, value: number) => { const delta = deltas.get(id); if (delta) delta[index] = value; };
      if (request.kind === "align") {
        for (const id of request.objectIds) for (const item of request.axes) {
          const i = axisIndex[item];
          setDelta(id, i, coordinate(get(request.referenceId), i, request.referenceAnchor) - coordinate(get(id), i, request.sourceAnchor));
        }
      } else if (request.kind === "gap") {
        const units = getUnits ? getUnits(context.userId, context.projectId) : snapshot.measurementUnits;
        if (request.unit !== "scene" && !units) throw new Error("Calibrate project units before physical placement");
        const gap = request.gap * (request.unit === "scene" ? 1 : metersPerUnit[request.unit] / (units?.metersPerSceneUnit ?? 1));
        const i = axisIndex[request.axis], positive = request.side === "positive";
        const target = coordinate(get(request.referenceId), i, positive ? "max" : "min") + (positive ? gap : -gap);
        for (const id of request.objectIds) setDelta(id, i, target - coordinate(get(id), i, positive ? "min" : "max"));
      } else if (request.kind === "distribute") {
        const i = axisIndex[request.axis];
        const firstId = request.objectIds[0], lastId = request.objectIds.at(-1);
        if (!firstId || !lastId) throw new Error("Missing endpoints");
        const first = get(firstId), last = get(lastId);
        let previous = -Infinity;
        for (const id of request.objectIds) {
          const center = coordinate(get(id), i, "center");
          if (center < previous) throw new Error("Supply objects in increasing spatial order on the chosen axis");
          previous = center;
        }
        const sizes = request.objectIds.map((id) => get(id).size[i] ?? 0);
        const available = coordinate(last, i, "max") - coordinate(first, i, "min");
        const gap = (available - sizes.reduce((sum, value) => sum + value, 0)) / (request.objectIds.length - 1);
        if (request.mode === "gaps" && gap < 0) throw new Error("Endpoints leave insufficient space for non-overlapping distribution");
        let edge = coordinate(first, i, "max") + gap;
        request.objectIds.slice(1, -1).forEach((id, offset) => {
          const data = get(id);
          const delta = request.mode === "centers"
            ? coordinate(first, i, "center") + (coordinate(last, i, "center") - coordinate(first, i, "center")) * (offset + 1) / (request.objectIds.length - 1) - coordinate(data, i, "center")
            : edge - coordinate(data, i, "min");
          setDelta(id, i, delta);
          edge += (data.size[i] ?? 0) + gap;
        });
      } else {
        request.objectIds.forEach((id) => request.from.forEach((value, i) => setDelta(id, i, (request.to[i] ?? 0) - value)));
      }
      const commands = [];
      for (const [id, world] of deltas) {
        if (world.every((value) => Math.abs(value) < 1e-10)) continue;
        const inverse = get(id).parentWorldInverse;
        if (!inverse) throw new Error(`Parent transform is singular for ${id}`);
        const delta = [0, 1, 2].map((row) => world.reduce((sum, value, col) => sum + value * (inverse[col * 4 + row] ?? 0), 0));
        commands.push({ commandId: `placement_${commands.length}`, type: "scene.move_object" as const, objectId: id, delta });
      }
      return { sourceRevision: snapshot.revision, commands: commands.length ? editorCommandListSchema.parse(commands) : [],
        status: commands.length ? "planned" : "already_placed", nextAction: "Propose commands with expectedRevision: sourceRevision, then apply. Re-measure the result." };
    },
  });
}
