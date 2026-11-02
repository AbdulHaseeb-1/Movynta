/*
 * BENCH: Checking a proposed batch of scene commands against the live scene
 * TIER: MEDIUM
 * SUBJECT: apps/backend/src/modules/editor-bridge/proposals/command-proposal.service.ts#validateAgainstContext
 * MEASURES: latency
 * COMPLEXITY: O(objects + commands) for creates, transforms and deletes
 * INPUTS: scene objects 250..2000 (the cap); 50 commands per batch (the cap); seed 20260402
 * BASELINE: baselines/backend/validator.baseline.json
 * THRESHOLD: fail if median regresses >25% (and beyond 3x the baseline spread) or p95 >40%
 * EXCLUDES: the WebSocket round trip that fetches the scene
 * NOTES: runs once per proposal the assistant makes. A batch of deletes must find out whether anything still
 *        hangs below each object; scanning the scene for that made 50 deletes cost 12 ms at 2,000 objects.
 */
import "reflect-metadata";
import { describe, it } from "vitest";
import { validateAgainstContext } from "../../../apps/backend/src/modules/editor-bridge/proposals/command-proposal.service";
import type { EditorCommand } from "../../../apps/backend/src/shared/types/editor-command.types";
import type { EditorContext } from "../../../apps/backend/src/shared/types/editor-context.types";
import { measureCases, type BenchCase } from "../../lib/harness";
import { finishWithGrowth } from "../../lib/report";
import { consume } from "../../lib/sink";

const OBJECT_COUNTS = [250, 500, 1000, 2000];

function contextOf(objects: number): EditorContext {
  return {
    projectId: "prj_bench",
    revision: 1,
    activeSceneName: "Main",
    selectedObjectIds: [],
    objects: Array.from({ length: objects }, (_, index) => ({
      id: `obj_${index}`,
      name: `Object ${index}`,
      type: "empty" as const,
      // Every tenth object hangs below the one before it, so the scene has some hierarchy.
      parentId: index % 10 === 0 && index > 0 ? `obj_${index - 1}` : null,
      transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    })) as unknown as EditorContext["objects"],
  };
}

const create = (index: number): EditorCommand => ({ type: "scene.create_object", commandId: `c-${index}`, objectId: `new_${index}`, name: `New ${index}` });
const transform = (index: number, objects: number): EditorCommand => ({
  type: "scene.transform_object",
  commandId: `t-${index}`,
  objectId: `obj_${(index * 7) % objects}`,
  transform: { position: [index, 0, 0] },
});
const remove = (index: number, objects: number): EditorCommand => ({
  type: "scene.delete_object",
  commandId: `d-${index}`,
  objectId: `obj_${objects - 1 - index * 10}`,
});

describe("proposal validation", () => {
  it("checks creates, transforms and deletes", async () => {
    const cases: BenchCase[] = OBJECT_COUNTS.flatMap((objects) => {
      const context = contextOf(objects);
      const batch = (make: (index: number) => EditorCommand) => Array.from({ length: 50 }, (_, index) => make(index));
      const creates = batch(create);
      const transforms = batch((index) => transform(index, objects));
      const deletes = batch((index) => remove(index, objects));
      return [
        { name: "validate 50 creates", params: { objects }, run: () => consume(validateAgainstContext(creates, context).length) },
        { name: "validate 50 transforms", params: { objects }, run: () => consume(validateAgainstContext(transforms, context).length) },
        { name: "validate 50 deletes", params: { objects }, run: () => consume(validateAgainstContext(deletes, context).length) },
      ];
    });
    const results = await measureCases(cases);
    // Building the lookup of the scene is linear, but a map costs more per entry as it outgrows the cache and
    // each time it is rebuilt at a larger size, so the curve bends up between 250 and 2000 objects. The
    // tolerance allows for that; a quadratic cost would still read as n^2 or more.
    const claim = (name: string) => ({
      key: "objects",
      declared: 1,
      tolerance: 0.7,
      label: name,
      where: (result: { name: string }) => result.name === name,
    });
    finishWithGrowth("backend/validator", results, [
      claim("validate 50 creates"),
      claim("validate 50 transforms"),
      claim("validate 50 deletes"),
    ]);
  });
});
