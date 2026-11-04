import { z } from "zod";
import { meshInspectionRequestSchema } from "@movynta/editor-protocol";
import type { AgentRunContext } from "../../agent-runs/agent-runs.types.js";
import type { EditorBridge } from "../../editor-bridge/editor-bridge.types.js";
import { editorCommandListSchema } from "../../../shared/schemas/editor-command.schema.js";
import { defineTool, type ToolDefinition } from "../tool.types.js";
import type { EditorToolDependencies } from "./editor.types.js";

const identifier = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const noInput = z.object({}).strict();

/** Every editor tool first confirms the run's editor connection is still live for this user. */
function assertConnection(bridge: EditorBridge, context: AgentRunContext): void {
  bridge.assertConnection(context.userId, context.projectId, context.clientId);
}

export function createEditorTools({ bridge, proposals }: EditorToolDependencies): ToolDefinition[] {
  return [
    defineTool({
      name: "editor.inspect_mesh", permission: "read",
      description: "Inspect mesh topology and local-space vertex/edge/face samples. Supply objectId, optional meshPath (child-index path, [] for the object itself), offset and limit (1–100, default 25). Imported groups return available mesh parts with paths; inspect one path next. Returns welded polygon topology, counts, boundary/non-manifold/inconsistent edges, render attributes and groups, the live modifiers and base triangle count, skin/morph status, local bounds and column-major matrixWorld. Positions are local to the target mesh. Faces/edges reference the full vertex index space, so page vertices separately as needed. Source meshes above 20000 triangles may be unsupported. Nothing changes.",
      parameters: meshInspectionRequestSchema,
      execute: async (input, context) => {
        assertConnection(bridge, context);
        const scene = await bridge.getContext(context.clientId, input);
        return { revision: scene.revision, inspection: scene.meshInspection ?? null, message: scene.meshInspection ? null : "This editor does not support mesh inspection" };
      },
    }),
    defineTool({
      name: "editor.get_context",
      description: "Read the current editor scene: objects, parents, local transforms, world-space geometry bounds when supported, visibility, selection, and revision.",
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
      description: [
        "Submit a batch of structured scene commands for preview. A proposal alone does not request approval or show an approval card. After a successful proposal, call editor.apply_proposal with the returned proposalId even if requiresApproval is true; that call requests approval when needed. Nothing changes until the proposal is approved and applied.",
        "Commands run in order, and later commands may use objects created earlier in the same batch.",
        "Change existing objects with scene.rename_object, scene.set_visibility and scene.set_parent instead of recreating them.",
        "geometry.bevel adds a live bevel modifier (local-space width, segments 1–8 default 1, profile chamfer or round default round, angle 0–180 degrees default 0 so every manifold edge is beveled). geometry.subdivide adds a live modifier with levels 1–3 and method catmull-clark (default), linear, or loop. geometry.set_modifiers replaces the ordered stack (at most eight entries); each entry has unique id, kind bevel/subdivision, enabled, and its parameters. Read editor.inspect_mesh.modifiers before editing; preserve existing ids to update, change order to reorder, enabled false to disable, or send an empty list to restore the base. Bevel supports manifold concave and open meshes; open boundaries remain open. Textures, UV seams, material groups, skinning, vertex colors and morph targets are preserved/interpolated. Both geometric and stack edits require approval and reject revision changes. Submit only geometry modifier commands in a batch (at most 20); create/transform separately. Width overlaps and invalid topology are rejected.",
        "geometry.extrude rewrites the base cage. kind is vertex, edge or face. ids are inspect_mesh face indices, canonical edge keys min_max, or vertex indices. offset is a non-zero mesh-local [x, y, z]. Faces move as one cap and grow boundary quads. Edges grow quads. A lone vertex is rejected. Disable enabled modifiers first so ids match the base. Extrude requires approval and a batch of only extrude commands (at most 20).",
        "geometry.subdivide_faces splits only the listed faces of the base cage, and the rest of the mesh is unchanged. ids are inspect_mesh face indices (at most 4096). Each selected face gets a centre point and one quad per corner; neighbours receive the shared midpoints so the mesh stays closed. Use it when the user asks to subdivide part of an object; geometry.subdivide applies to the whole object. Disable enabled modifiers first. It requires approval and a strict revision, and it can share a batch only with geometry.extrude (at most 20 commands).",
        "geometry.create_primitive creates a new object by itself (box, sphere, cylinder, cone, torus or plane): give it a fresh objectId, then place it with scene.transform_object. Do not call scene.create_object first for the same objectId.",
        "scene.create_object makes an empty group or parent. replaceExisting true on geometry.create_primitive changes the shape of an object that already exists.",
        "If the proposal is rejected, the error lists each problem with the commandId and how to fix it; correct those commands and propose again.",
        "If the user changes the request while a proposal still waits, send the new batch with supersedes set to that proposal's id; it replaces the waiting one.",
        "stepId names the step of the latest plan that this batch carries out.",
        "For calculated commands, pass expectedRevision from modeling.generate_commands.sourceRevision. Such proposals fail if the scene changes before proposal or application; regenerate instead of rebasing.",
      ].join(" "),
      permission: "propose",
      parameters: z
        .object({
          summary: z.string().min(1).max(300),
          commands: editorCommandListSchema,
          expectedRevision: z.number().int().nonnegative().optional(),
          supersedes: identifier.optional(),
          stepId: identifier.optional(),
        })
        .strict(),
      execute: async (input, context) => {
        assertConnection(bridge, context);
        const latestPlan = context.plans[context.plans.length - 1];
        const steps = latestPlan?.steps ?? [];
        const planStep = input.stepId === undefined ? undefined : steps.find((step) => step.id === input.stepId);
        if (input.stepId !== undefined && !planStep) {
          return {
            status: "rejected",
            reason: "stepId does not match a step of the latest plan. Record a plan first, or leave stepId out.",
            availableStepIds: steps.map((step) => step.id),
          };
        }
        const proposal = await proposals.propose(
          { id: context.runId, userId: context.userId, projectId: context.projectId, clientId: context.clientId },
          { summary: input.summary, commands: input.commands, supersedes: input.supersedes, expectedRevision: input.expectedRevision },
        );
        context.events.emit("editor.proposal.created", {
          proposalId: proposal.id,
          summary: proposal.summary,
          requiresApproval: proposal.requiresApproval,
          commandCount: proposal.commands.length,
          baseRevision: proposal.baseRevision,
          supersedes: input.supersedes ?? null,
          planStepId: planStep?.id ?? null,
        });
        return {
          proposalId: proposal.id,
          status: proposal.status,
          requiresApproval: proposal.requiresApproval,
          commandCount: proposal.commands.length,
          baseRevision: proposal.baseRevision,
          supersedes: input.supersedes ?? null,
          planStep: planStep ? { id: planStep.id, title: planStep.title } : null,
          nextAction: "Call editor.apply_proposal with this proposalId. If approval is required, that call will request it before applying the changes.",
        };
      },
    }),

    defineTool({
      name: "editor.apply_proposal",
      description: [
        "Apply a previously proposed batch in the editor. Destructive or large batches need user approval first.",
        "If the scene changed since the proposal was made, the batch runs again on the new scene when every command still fits;",
        "the result then has rebased true. Otherwise the result is failed and the batch must be proposed again.",
      ].join(" "),
      permission: "apply",
      parameters: z.object({ proposalId: identifier }).strict(),
      // An unknown proposal is treated as needing approval, so a person still sees the request.
      requiresApproval: (input, context) => {
        try {
          return proposals.require(context.runId, input.proposalId).requiresApproval;
        } catch {
          return true;
        }
      },
      execute: async (input, context) => {
        assertConnection(bridge, context);
        const result = await proposals.apply(
          { id: context.runId, userId: context.userId, projectId: context.projectId, clientId: context.clientId },
          input.proposalId,
        );
        return {
          proposalId: result.proposalId,
          status: result.status,
          revision: result.revision ?? null,
          results: result.results,
          message: result.message ?? null,
          rebased: result.rebased ?? false,
        };
      },
    }),
  ];
}
