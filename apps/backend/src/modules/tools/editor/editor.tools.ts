import { z } from "zod";
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
      name: "editor.get_context",
      description: "Read the current editor scene: objects, parents, selection, and the scene revision.",
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
        "Submit a batch of structured scene commands for preview. Nothing changes until editor.apply_proposal runs.",
        "Commands run in order, and later commands may use objects created earlier in the same batch.",
        "geometry.create_primitive creates a new object by itself (a box, sphere, cylinder or plane): give it a fresh objectId, then place it with scene.transform_object. Do not call scene.create_object first for the same objectId.",
        "scene.create_object makes an empty group or parent. replaceExisting true on geometry.create_primitive changes the shape of an object that already exists.",
        "If the proposal is rejected, the error lists each problem with the commandId and how to fix it; correct those commands and propose again.",
      ].join(" "),
      permission: "propose",
      parameters: z.object({
        summary: z.string().min(1).max(300),
        commands: editorCommandListSchema,
      }),
      execute: async (input, context) => {
        assertConnection(bridge, context);
        const proposal = await proposals.propose(
          { id: context.runId, userId: context.userId, projectId: context.projectId, clientId: context.clientId },
          input,
        );
        context.events.emit("editor.proposal.created", {
          proposalId: proposal.id,
          summary: proposal.summary,
          requiresApproval: proposal.requiresApproval,
          commandCount: proposal.commands.length,
          baseRevision: proposal.baseRevision,
        });
        return {
          proposalId: proposal.id,
          status: proposal.status,
          requiresApproval: proposal.requiresApproval,
          commandCount: proposal.commands.length,
          baseRevision: proposal.baseRevision,
        };
      },
    }),

    defineTool({
      name: "editor.apply_proposal",
      description: "Apply a previously proposed batch in the editor. Destructive or large batches need user approval first.",
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
        };
      },
    }),
  ];
}
