import { z } from "zod";
import { CAGE_EDIT_COMMAND_TYPES, MODIFIER_COMMAND_TYPES, TOPOLOGY_EDIT_COMMAND_TYPES, materialInspectionRequestSchema, measurementRequestSchema, meshInspectionRequestSchema, editorCommandListSchema, type EditorCommand } from "@movynta/editor-protocol";
import type { AgentRunContext } from "../../agent-runs/agent-runs.types.js";
import type { EditorBridge } from "../../editor-bridge/editor-bridge.types.js";

import { defineTool, type ToolDefinition } from "../tool.types.js";
import type { EditorToolDependencies } from "./editor.types.js";
import { createPlacementTool } from "./placement.tools.js";
import { createDuplicationTool } from "./duplication.tools.js";
import { createSceneTools } from "../scene/scene.tools.js";
import { COMMAND_REFERENCE, COMMAND_TYPES, isCommandType, proposeCommandsDescription } from "./command-reference.js";
import { closestValues } from "../tool-input-issues.js";
import { applyProposal, afterApply, proposalRun, recordProposal, resolvePlanStep } from "./proposal-flow.js";
import { findPlannedBatch } from "../../agent-runs/run-progress.js";
import { AppError } from "../../../common/errors/app-error.js";


const identifier = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const noInput = z.object({}).strict();

/** Every editor tool first confirms the run's editor connection is still live for this user. */
function assertConnection(bridge: EditorBridge, context: AgentRunContext): void {
  bridge.assertConnection(context.userId, context.projectId, context.clientId);
}

/** The commands a proposal is made of: given directly, or a batch a planning tool kept under its planId. */
type BatchLookup =
  | { readonly ok: true; readonly commands: EditorCommand[]; readonly expectedRevision: number | undefined }
  | { readonly ok: false; readonly rejection: Readonly<Record<string, unknown>> };

function resolveBatch(
  context: AgentRunContext,
  input: { readonly commands?: EditorCommand[] | undefined; readonly planId?: string | undefined; readonly expectedRevision?: number | undefined },
): BatchLookup {
  if ((input.commands === undefined) === (input.planId === undefined)) {
    return { ok: false, rejection: { status: "rejected", reason: "Give either commands or the planId a planning tool returned, not both and not neither." } };
  }
  if (input.commands !== undefined) return { ok: true, commands: input.commands, expectedRevision: input.expectedRevision };
  const planned = input.planId === undefined ? undefined : findPlannedBatch(context.progress, input.planId);
  if (!planned) {
    return {
      ok: false,
      rejection: {
        status: "rejected",
        reason: "No planned batch has this planId in this run; plan it again, or pass the commands.",
        availablePlanIds: context.progress.plannedBatches.map((batch) => batch.id),
      },
    };
  }
  if (input.expectedRevision !== undefined && input.expectedRevision !== planned.sourceRevision) {
    return { ok: false, rejection: { status: "rejected", reason: `This batch was planned at revision ${planned.sourceRevision}; leave expectedRevision out or plan again.` } };
  }
  const commands = editorCommandListSchema.safeParse(planned.commands);
  if (!commands.success) return { ok: false, rejection: { status: "rejected", reason: "The planned batch could not be read; plan it again." } };
  return { ok: true, commands: commands.data, expectedRevision: planned.sourceRevision };
}

export function createEditorTools(dependencies: EditorToolDependencies): ToolDefinition[] {
  const { bridge, proposals, getUnits } = dependencies;
  return [
    createPlacementTool(dependencies),
    createDuplicationTool(dependencies),
    ...createSceneTools(dependencies),
    defineTool({
      name: "editor.describe_commands", permission: "read",
      description: "The full rules of editor commands: what each field does, its limits, how it batches, and what it refuses. editor.propose_commands lists every command in one line; call this with the types you are about to use (1–12), before the first geometry or material command of a kind in a run. Reads nothing from the scene.",
      parameters: z.object({ types: z.array(z.string().min(1).max(64)).min(1).max(12) }).strict(),
      execute: ({ types }) => {
        const unique = [...new Set(types)];
        return {
          commands: unique.filter(isCommandType).map((type) => ({ type, summary: COMMAND_REFERENCE[type].summary, rules: COMMAND_REFERENCE[type].rules })),
          unknown: unique.filter((type) => !isCommandType(type)).map((type) => ({ type, closest: closestValues(type, COMMAND_TYPES) })),
        };
      },
    }),
    defineTool({
      name: "editor.inspect_materials", permission: "read",
      description: "Read current material slots without parsing mesh topology. Supply objectId, meshPath (default []), offset and limit (1–100). Returns revision, materialSlotCount, and paged materials with slot index, name, shader type, editable flag, sRGB color/emissive, roughness, metalness, opacity, transparency, depthWrite, side and texture channel names. Standard and Physical material properties are editable while preserving imported maps/physical settings. Other shaders require explicit material.replace_slot. Group targets return available mesh parts. Use the returned revision for material proposals. No mutation or approval.",
      parameters: materialInspectionRequestSchema,
      execute: async (input, context) => {
        assertConnection(bridge, context);
        const scene = await bridge.getContext(context.clientId, { ...input, materialsOnly: true });
        const result = scene.meshInspection;
        return { revision: scene.revision, status: result?.status ?? "unsupported", materialSlotCount: result?.materialSlotCount ?? null,
          materials: result?.materials ?? [], parts: result?.parts ?? [], message: result?.message ?? (result?.materialSlotCount === undefined ? "Update the editor to support material inspection" : null) };
      },
    }),
    defineTool({
      name: "editor.measure", permission: "read",
      description: "Measure current geometry. dimensions returns exact evaluated triangle bounds, size and center in world or target-local axes, including descendants and hidden geometry by default. distance accepts world points or revision-bound mesh vertex references. edge accepts a canonical edge ID and revision. angle accepts from/at/to points or vertex references and returns degrees. clearance accepts first/second targets and method bounds (axis gaps, not a collision test) or surface (minimum boundary-surface distance, including intersections; containment can have positive distance). Surface searches are limited to 20000 triangles per target and a bounded work budget. Values are scene units. measurementUnits gives display and metersPerSceneUnit, or null for unitless. Use the returned revision for proposals. Re-measure after applying. Unavailable results explain unsupported inputs.",
      parameters: z.object({ request: measurementRequestSchema }).strict(),
      execute: async (input, context) => {
        assertConnection(bridge, context);
        const scene = await bridge.getContext(context.clientId, undefined, input.request);
        return { revision: scene.revision, units: getUnits ? getUnits(context.userId, context.projectId) : scene.measurementUnits ?? null,
          result: scene.measurement ?? { status: "unavailable", message: "Update the connected editor to support measurements" } };
      },
    }),
    defineTool({
      name: "editor.inspect_mesh", permission: "read",
      description: "Inspect mesh topology and local-space vertex/edge/face samples. Supply objectId, optional meshPath (a path to a mesh inside the object, [] for the object itself: each step is a part name such as 'Arm', 'Arm#1' for the second part with that name, or a child index; use the paths this tool returns, which give names wherever a part has one and so keep meaning the same part when others change), view ('base' or 'evaluated', default evaluated), offset and limit (1–100, default 25). Base inspects the unmodified cage; evaluated inspects the displayed mesh. To find faces efficiently, use faceQuery.normal (mesh-local direction), minDot (default 0.9), and/or mesh-local centerMin/centerMax. faceMatches returns IDs, total, offset and hasMore; faceQuery.limit is 1–1000, default 100. Set includeSamples false to omit vertex, edge and face pages. Example: faceQuery {normal:[0,1,0], minDot:0.95} finds upward-facing local faces. To close or join openings, set openings {} (optional offset, limit 1–50, default 20): it returns each opening as loops[] with edges (canonical edge IDs in walking order, at most 256, ready to pass whole to geometry.fill_hole, or two loops concatenated to geometry.bridge_edge_loops), edgeCount, truncated (true when the loop has more edges than listed, so it cannot be passed whole), and its center/min/max, plus total, hasMore and irregularEdges (boundary edges not in a simple loop). To find the separate parts of a mesh, set shells {}: it returns shells[] with faceCount, firstFace (a face ID that names the whole part, for geometry.flip_normals), closed, center/min/max, plus total and hasMore. Use view base for IDs you will edit with. Use returned IDs only with that view and revision. Imported groups return mesh paths. Evaluated faces may carry baseFaceIndex when their source is known. Source meshes above 20000 triangles may be unsupported. Nothing changes.",
      parameters: meshInspectionRequestSchema,
      execute: async (input, context) => {
        assertConnection(bridge, context);
        const scene = await bridge.getContext(context.clientId, input);
        return { revision: scene.revision, inspection: scene.meshInspection ?? null, message: scene.meshInspection ? null : "This editor does not support mesh inspection" };
      },
    }),
    defineTool({
      name: "editor.get_context",
      description: "Read the editor scene and revision. designFocus includes Edit-mode picks. When modifiersEnabled is true, ids name the display mesh. For face picks, baseFaceIds contains the distinct base faces only when every pick has a known source. A mapped edit affects the whole source face, including unpicked display fragments. Use baseFaceIds with componentView base and expectedRevision from this context. If the mapping is absent, identify components through a base inspection.",
      permission: "read",
      parameters: noInput,
      execute: (_input, context) => {
        assertConnection(bridge, context);
        return bridge.getContext(context.clientId);
      },
    }),

    defineTool({
      name: "editor.get_scene_summary",
      description: "Summarise the current scene: object counts by type, selection, and revision.",
      permission: "read",
      parameters: noInput,
      execute: async (_input, context) => {
        assertConnection(bridge, context);
        const scene = await bridge.getContext(context.clientId);
        const countsByType: Record<string, number> = {};
        for (const object of scene.objects) {
          countsByType[object.type] = (countsByType[object.type] ?? 0) + 1;
        }
        return {
          revision: scene.revision,
          activeSceneName: scene.activeSceneName,
          objectCount: scene.objects.length,
          countsByType,
          selectedObjectIds: scene.selectedObjectIds,
        };
      },
    }),

    defineTool({
      name: "editor.propose_commands",
      description: proposeCommandsDescription({
        cageEdits: CAGE_EDIT_COMMAND_TYPES,
        topologyEdits: TOPOLOGY_EDIT_COMMAND_TYPES,
        modifiers: MODIFIER_COMMAND_TYPES,
      }),
      permission: "propose",
      parameters: z
        .object({
          summary: z.string().min(1).max(300),
          commands: editorCommandListSchema.optional(),
          planId: identifier.optional(),
          expectedRevision: z.number().int().nonnegative().optional(),
          supersedes: identifier.optional(),
          stepId: identifier.optional(),
          apply: z.boolean().optional(),
        })
        .strict(),
      execute: async (input, context) => {
        assertConnection(bridge, context);
        const step = resolvePlanStep(context, input.stepId);
        if (!step.ok) return step.rejection;
        const batch = resolveBatch(context, input);
        if (!batch.ok) return batch.rejection;
        const proposal = await proposals.propose(proposalRun(context), {
          summary: input.summary,
          commands: batch.commands,
          supersedes: input.supersedes,
          expectedRevision: batch.expectedRevision,
        });
        recordProposal(context, proposal, { stepId: step.step?.id, supersedes: input.supersedes });
        const proposed = {
          proposalId: proposal.id,
          status: proposal.status,
          requiresApproval: proposal.requiresApproval,
          commandCount: proposal.commands.length,
          baseRevision: proposal.baseRevision,
          supersedes: input.supersedes ?? null,
          planStep: step.step ?? null,
        };
        // A proposal the policy holds for the user is never applied from here; it waits for editor.apply_proposal.
        if (input.apply !== true || proposal.requiresApproval) {
          return { ...proposed, nextAction: "Call editor.apply_proposal with this proposalId to apply automatically." };
        }
        let applied;
        try {
          applied = await applyProposal(proposals, context, proposal.id);
        } catch (error) {
          // The proposal exists, so the model needs its id to try the apply again.
          if (!(error instanceof AppError)) throw error;
          return { ...proposed, applyError: error.message, nextAction: "The proposal was made but not applied. Call editor.apply_proposal with this proposalId to try again." };
        }
        return { ...proposed, ...applied, nextAction: afterApply(applied) };
      },
    }),

    defineTool({
      name: "editor.apply_proposal",
      description: [
        "Apply a previously proposed batch automatically, including destructive and large batches. Ownership, validation and revision checks remain enforced.",
        "If the scene changed since the proposal was made, the batch runs again on the new scene when every command still fits;",
        "the result then has rebased true. Otherwise the result is failed and the batch must be proposed again.",
        "Each entry of results may carry name, the name an object received from a command that created, renamed or re-parented it; a name already used by a sibling gets a number.",
        "editor.propose_commands with apply true does the same in one call.",
      ].join(" "),
      permission: "apply",
      parameters: z.object({ proposalId: identifier }).strict(),
      // Also applies proposals stored before automatic approval was enabled. Unknown IDs fail in apply.
      requiresApproval: () => false,
      execute: async (input, context) => {
        assertConnection(bridge, context);
        // The scene now differs from the last check, so the run must check it again before it can finish.
        return applyProposal(proposals, context, input.proposalId);
      },
    }),
  ];
}
