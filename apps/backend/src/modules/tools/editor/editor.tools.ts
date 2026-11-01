import { z } from "zod";
import type { AgentRunContext } from "../../agent-runs/agent-runs.types.js";
import type { EditorBridge } from "../../editor-bridge/editor-bridge.types.js";
import { editorCommandListSchema } from "../../../shared/schemas/editor-command.schema.js";
import { TOOL_NAMES } from "../catalog/index.js";
import { defineTool, type ToolDefinition } from "../tool.types.js";
import type { EditorToolDependencies } from "./editor.types.js";

const proposalId = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,64}$/)
  .describe("The exact proposalId returned by editor.propose_commands");
const noInput = z.object({}).strict();

/** Every editor tool first confirms the run's editor connection is still live for this user. */
function assertConnection(bridge: EditorBridge, context: AgentRunContext): void {
  bridge.assertConnection(context.userId, context.projectId, context.clientId);
}

export function createEditorTools({ bridge, proposals }: EditorToolDependencies): ToolDefinition[] {
  return [
    defineTool({
      name: TOOL_NAMES.editorGetContext,
      description:
        "Read the full current scene: every object with its id, name, type, parent and transform, plus the selection and the scene revision. Call it before proposing changes and again after a revision conflict. On a large scene call editor.get_scene_summary first.",
      permission: "read",
      parameters: noInput,
      execute: (_input, context) => {
        assertConnection(bridge, context);
        return bridge.getContext(context.clientId);
      },
    }),

    defineTool({
      name: TOOL_NAMES.editorGetSceneSummary,
      description:
        "Get a compact overview of the scene: object counts by type, selected object ids, the active scene name and the revision. Use it to orient quickly; it does not list individual objects (use editor.get_context for that).",
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
      name: TOOL_NAMES.editorProposeCommands,
      description:
        "Submit a batch of structured scene commands for preview. Nothing changes in the scene until editor.apply_proposal runs. Returns proposalId, whether user approval is required, the command count and the base revision. Prefer small batches (20 commands or fewer) that are easy to review.",
      permission: "propose",
      parameters: z.object({
        summary: z.string().min(1).max(300).describe("One sentence shown to the user, 1-300 characters"),
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
      name: TOOL_NAMES.editorApplyProposal,
      description:
        "Apply a proposal created by editor.propose_commands. Deletions, replacements and batches over 20 commands wait for the user's approval first. Returns the final status, the new revision and the result of each command. If the scene changed in the meantime, call editor.get_context and propose again.",
      permission: "apply",
      parameters: z.object({ proposalId }).strict(),
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
