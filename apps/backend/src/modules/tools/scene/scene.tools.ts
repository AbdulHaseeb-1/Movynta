import { z } from "zod";
import { identifierSchema } from "@movynta/editor-protocol";
import { ValidationFailedError } from "../../../common/errors/app-error.js";
import { defineTool, type ToolDefinition } from "../tool.types.js";
import type { EditorToolDependencies } from "../editor/editor.types.js";
import { DEFAULT_FOLD_FROM, MAX_BRANCH_ENTRIES, readBranch } from "./branch.js";
import { MAX_MEMBER_IDS, findRepeats } from "./repeats.js";
import { queryObjects } from "./query.js";
import { SceneIndex } from "./scene-index.js";
import { SignatureBook } from "./signature.js";

const range = z
  .object({ min: z.number().finite().optional(), max: z.number().finite().optional() })
  .strict()
  .refine((value) => value.min !== undefined || value.max !== undefined, "Give min, max or both")
  .refine(
    (value) => value.min === undefined || value.max === undefined || value.min <= value.max,
    "min must not be above max",
  );
const axisRanges = z.object({ x: range.optional(), y: range.optional(), z: range.optional() }).strict();

/** The input schema of editor.read_branch. */
export const readBranchParameters = z
  .object({
    rootId: identifierSchema.optional(),
    depth: z.number().int().min(1).max(4).default(1),
    childLimit: z.number().int().min(1).max(100).default(30),
    childOffset: z.number().int().min(0).max(100000).default(0),
    foldRepeats: z.boolean().default(true),
  })
  .strict();

/** The input schema of editor.find_repeats. */
export const findRepeatsParameters = z
  .object({
    rootId: identifierSchema.optional(),
    minCount: z.number().int().min(2).max(500).default(3),
    limit: z.number().int().min(1).max(20).default(10),
  })
  .strict();

/** The input schema of editor.query_objects. */
export const queryObjectsParameters = z
  .object({
    nameMatches: z.string().trim().min(1).max(80).optional(),
    type: z
      .array(z.enum(["mesh", "empty", "collection", "camera", "light"]))
      .min(1)
      .max(5)
      .optional(),
    parentId: identifierSchema.nullable().optional(),
    withinId: identifierSchema.optional(),
    visible: z.boolean().optional(),
    selected: z.boolean().optional(),
    size: axisRanges.optional(),
    position: axisRanges.optional(),
    sortBy: z.enum(["scene", "name", "size", "x", "y", "z"]).default("scene"),
    descending: z.boolean().default(false),
    offset: z.number().int().min(0).max(100000).default(0),
    limit: z.number().int().min(1).max(200).default(50),
    countOnly: z.boolean().default(false),
  })
  .strict();

function requireObject(index: SceneIndex, id: string, field: string): void {
  if (!index.has(id)) {
    throw new ValidationFailedError(
      `${field} "${id}" is not in the scene; read the scene with editor.read_branch to find the id`,
    );
  }
}

/**
 * Tools for reading a large scene by concept rather than by object: a tree that opens one branch at a time, a search
 * for things that repeat, and a selection by rule. All three read the editor's snapshot and change nothing.
 */
export function createSceneTools({ bridge }: EditorToolDependencies): ToolDefinition[] {
  return [
    defineTool({
      name: "editor.read_branch",
      permission: "read",
      description: `Read the scene as a tree, one branch at a time, instead of the whole flat list. Without rootId it lists the top level and the scene totals; with rootId it describes that object (path, size, what is inside) and lists its children. Each entry has name, type, world size and center, childCount, descendantCount and descendants by type. depth 1–4 opens that many levels (default 1). Look-alike siblings (same type, name ignoring numbering, size and contents; at least ${DEFAULT_FOLD_FROM} of them) are folded into one entry { repeat: true, count, templateId, exampleIds } unless foldRepeats is false; list every member with editor.find_repeats or editor.query_objects. A level shows childLimit entries (1–100, default 30); childrenOmitted and nextOffset page it with childOffset. One read returns at most ${MAX_BRANCH_ENTRIES} entries and sets truncated when it stops. Use this first on any scene with more than about 60 objects; use editor.get_context only for the exact transforms of objects you already chose.`,
      parameters: readBranchParameters,
      execute: async (input, context) => {
        bridge.assertConnection(context.userId, context.projectId, context.clientId);
        const scene = await bridge.getContext(context.clientId);
        const index = new SceneIndex(scene);
        if (input.rootId !== undefined) requireObject(index, input.rootId, "rootId");
        const read = readBranch(index, new SignatureBook(index), {
          rootId: input.rootId,
          depth: input.depth,
          childLimit: input.childLimit,
          childOffset: input.childOffset,
          foldFrom: input.foldRepeats ? DEFAULT_FOLD_FROM : 0,
        });
        const countsByType: Record<string, number> = {};
        if (input.rootId === undefined)
          for (const object of scene.objects) countsByType[object.type] = (countsByType[object.type] ?? 0) + 1;
        return {
          revision: index.revision,
          objectCount: index.total,
          ...(input.rootId === undefined ? { countsByType } : {}),
          ...(index.unreachable > 0 ? { unreachable: index.unreachable } : {}),
          ...read,
        };
      },
    }),

    defineTool({
      name: "editor.find_repeats",
      permission: "read",
      description: `Find objects that look like copies of one another, so a repeated part is one idea to change instead of many objects. Objects match when they have the same type, name (ignoring trailing numbers and "copy"), world size (to about three significant digits, ignoring which way they are turned a quarter turn) and the same kind of contents. A group of repeated windows is reported once, not again as its frames and panes. Optional rootId limits the search to one branch; minCount (2–500, default 3) is the smallest group; limit (1–20, default 10) caps the groups returned, largest first. Each group gives count, templateId, memberIds (first ${MAX_MEMBER_IDS}), size, descendantsEach, parents and the arrangement of the members' centers: line { axis, step }, grid { axes, counts, steps }, coincident or scattered. A line or grid maps onto editor.plan_duplicates (sourceId, copies, offset). Matching uses names, sizes and structure, not the geometry itself: confirm with editor.inspect_mesh on templateId and one other member before treating them as identical. Rotated by other than a quarter turn, or resized differently, copies are not matched.`,
      parameters: findRepeatsParameters,
      execute: async (input, context) => {
        bridge.assertConnection(context.userId, context.projectId, context.clientId);
        const scene = await bridge.getContext(context.clientId);
        const index = new SceneIndex(scene);
        if (input.rootId !== undefined) requireObject(index, input.rootId, "rootId");
        const report = findRepeats(index, new SignatureBook(index), {
          rootId: input.rootId,
          minCount: input.minCount,
          limit: input.limit,
        });
        return {
          revision: index.revision,
          ...report,
          confidence: "Matched by type, name, size and contents; geometry is not compared.",
        };
      },
    }),

    defineTool({
      name: "editor.query_objects",
      permission: "read",
      description: `Select objects by rule instead of by id. Every filter given must hold. nameMatches is a name pattern (* is any run of characters, ? is one, case ignored). type is a list of mesh, empty, collection, camera, light. parentId selects direct children of an object (null for the top level); withinId selects everything below an object at any depth. visible and selected filter on those flags. size and position take { x, y, z } ranges of { min, max } on the world extents and on the center of the world bounds; objects with no geometry never match a size or position filter. sortBy scene (default), name, size (volume), x, y or z, with descending. limit (1–200, default 50) and offset page the matches; countOnly returns just the total. Each match has id, name, type, parentId, size and center. Use the ids in the commands that follow. Matches are of the snapshot at the revision returned: a later change can make them stale, so read again after editing.`,
      parameters: queryObjectsParameters,
      execute: async (input, context) => {
        bridge.assertConnection(context.userId, context.projectId, context.clientId);
        const scene = await bridge.getContext(context.clientId);
        const index = new SceneIndex(scene);
        if (input.withinId !== undefined) requireObject(index, input.withinId, "withinId");
        if (typeof input.parentId === "string") requireObject(index, input.parentId, "parentId");
        const result = queryObjects(
          index,
          {
            nameMatches: input.nameMatches,
            type: input.type,
            parentId: input.parentId,
            withinId: input.withinId,
            visible: input.visible,
            selected: input.selected,
            size: input.size,
            position: input.position,
            sortBy: input.sortBy,
            descending: input.descending,
            offset: input.offset,
            limit: input.limit,
          },
          scene.selectedObjectIds,
        );
        if (input.countOnly) return { revision: index.revision, total: result.total };
        return { revision: index.revision, ...result };
      },
    }),
  ];
}
