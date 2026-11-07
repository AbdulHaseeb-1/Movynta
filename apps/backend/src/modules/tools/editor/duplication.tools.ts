import { z } from "zod";
import { editorCommandListSchema, identifierSchema, isWithinBranch } from "@movynta/editor-protocol";
import { defineTool } from "../tool.types.js";
import { rememberPlannedBatch } from "../../agent-runs/run-progress.js";
import { ServiceUnavailableError, ValidationFailedError } from "../../../common/errors/app-error.js";
import type { EditorToolDependencies } from "./editor.types.js";
import { newId } from "../../../common/ids/index.js";

/** Builds editor.plan_duplicates, which plans independent copies of a hierarchy. */
export function createDuplicationTool({ bridge }: EditorToolDependencies) {
  return defineTool({
    name: "editor.plan_duplicates",
    permission: "read",
    description:
      "Plan independent hierarchy copies or a linear object array. sourceId names a registered scene object; copies is the number of additional roots (1–63). offset [x,y,z] is applied once per copy index in space parent (default) or world. Optional name supplies the root label. Reads the current hierarchy, generates fresh IDs for every registered descendant, and returns sourceRevision and validated scene.duplicate_hierarchy commands. Imported inner parts keep their names/paths. Geometry, materials, base cages and skeletons are independent; imported textures remain shared resources. Internal Boolean operands remap to each copy; external operands remain references and reevaluate. Collection memberships are retained. Propose at expectedRevision: sourceRevision, then apply automatically. Nothing changes in this tool. Limits: 2000 objects including copies and the editor's geometry memory budget.",
    parameters: z
      .object({
        sourceId: identifierSchema,
        copies: z.number().int().min(1).max(63),
        offset: z.array(z.number().finite().min(-100000).max(100000)).length(3),
        space: z.enum(["parent", "world"]).default("parent"),
        name: z.string().trim().min(1).max(80).optional(),
      })
      .strict(),
    execute: async (input, context) => {
      bridge.assertConnection(context.userId, context.projectId, context.clientId);
      const scene = await bridge.getContext(context.clientId);
      if (scene.supportsRepetition !== true)
        throw new ServiceUnavailableError("Update the editor for hierarchy duplication");
      const parents = new Map(scene.objects.map((object) => [object.id, object.parentId]));
      if (!parents.has(input.sourceId))
        throw new ValidationFailedError(
          `Source object "${input.sourceId}" does not exist; use an id from editor.get_context`,
        );
      const descendants = scene.objects.filter(
        (object) => object.id !== input.sourceId && isWithinBranch(object.id, input.sourceId, (id) => parents.get(id)),
      );
      if (scene.objects.length + (descendants.length + 1) * input.copies > 2000)
        throw new ValidationFailedError("Copies exceed the 2000-object scene limit; make fewer copies");
      const copies = Array.from({ length: input.copies }, () => ({
        objectId: newId("obj"),
        ...(input.name ? { name: input.name } : {}),
        descendants: descendants.map((object) => ({ sourceId: object.id, objectId: newId("obj") })),
      }));
      const commands = editorCommandListSchema.parse([
        {
          commandId: "duplicate",
          type: "scene.duplicate_hierarchy",
          sourceId: input.sourceId,
          copies,
          offset: input.offset,
          space: input.space,
        },
      ]);
      const planId = rememberPlannedBatch(context.progress, {
        tool: "editor.plan_duplicates",
        sourceRevision: scene.revision,
        commands,
      });
      return {
        sourceRevision: scene.revision,
        planId,
        commands,
        nextAction:
          "Call editor.propose_commands with this planId and apply true (no need to copy the generated ids), then inspect the copies.",
      };
    },
  });
}
