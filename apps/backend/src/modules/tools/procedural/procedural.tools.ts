import { z } from "zod";
import { meshInspectionRequestSchema } from "@movynta/editor-protocol";
import type { EditorToolDependencies } from "../editor/editor.types.js";
import type { CommandProposalService } from "../../editor-bridge/proposals/command-proposal.service.js";
import { validateAgainstContext } from "../../editor-bridge/proposals/command-proposal.service.js";
import { defineTool, type ToolDefinition } from "../tool.types.js";
import { generateCommands, MAX_PROGRAM_CHARACTERS } from "./procedural.runner.js";

/** Computation only: generated commands still go through propose_commands and apply_proposal. */
export function createProceduralTools({ bridge, proposals }: Pick<EditorToolDependencies, "bridge"> & { proposals: Pick<CommandProposalService, "propose"> }): ToolDefinition[] {
  const parameters = {
    source: z.string().min(1).max(MAX_PROGRAM_CHARACTERS),
    inspection: meshInspectionRequestSchema.optional(),
  };
  return [defineTool({
    name: "modeling.generate_commands",
    description: [
      "Run a synchronous JavaScript function body to calculate editor commands for procedural modeling (loops, arrays, math).",
      "The argument scene is a JSON snapshot with revision, objects, selection, transforms and world bounds when available. Pass inspection to expose the returned mesh inspection as the second argument mesh. For a faceQuery, mesh.faceMatches.ids contains the current page of IDs.",
      "Return an array of 1–200 commands using the editor.propose_commands command schema, with unique commandId values.",
      "Example: return Array.from({length: 5}, (_, i) => ({commandId: 'move_' + i, type: 'scene.transform_object', objectId: scene.selectedObjectIds[i], transform: {position: [i * 2, 0, 0]}}));",
      "No imports, host access, files, network, timers or async work. Limits: 16000 source characters, 250ms interpreter time, 16MiB guest heap.",
      "Nothing is applied or proposed. Submit successful commands to editor.propose_commands with expectedRevision equal to sourceRevision, then editor.apply_proposal.",
      "Use direct commands for simple edits. To generate custom shapes, return geometry.create_mesh commands with bounded vertices and indexed faces. Material property/slot commands use separate proposals after editor.inspect_materials; texture creation and UV authoring remain unavailable.",
    ].join(" "),
    permission: "read",
    parameters: z.object(parameters).strict(),
    execute: async ({ source, inspection }, context) => {
      bridge.assertConnection(context.userId, context.projectId, context.clientId);
      const scene = await bridge.getContext(context.clientId, inspection);
      if (inspection && scene.meshInspection?.status !== "ok") return { status: "rejected", message: scene.meshInspection?.message ?? "Mesh inspection unavailable", sourceRevision: scene.revision };
      try {
        const commands = await generateCommands(source, scene, context.signal);
        const issues = validateAgainstContext(commands, scene);
        if (issues.length > 0) return { status: "rejected", sourceRevision: scene.revision, issues };
        return { status: "generated", sourceRevision: scene.revision, commands };
      } catch (error) {
        context.signal.throwIfAborted();
        return { status: "rejected", message: error instanceof Error ? error.message.slice(0, 2000) : "Program failed" };
      }
    },
  }), defineTool({
    name: "modeling.propose_generated",
    description: [
      "Generate structured commands using the same isolated synchronous JavaScript environment as modeling.generate_commands and create a proposal without returning the full command arrays to the model.",
      "Arguments: summary, source, optional inspection. The guest receives scene and mesh. Use inspection.faceQuery with includeSamples false and mesh.faceMatches.ids to target local faces without repeating IDs in your prompt. Reject truncated pages or explicitly page them.",
      "The proposal is tied to the source revision and uses normal validation and automatic application. Use viewport.capture with the proposalId for geometry review, then call editor.apply_proposal to apply automatically without an approval prompt.",
      "Supports bounded geometry.create_mesh, parameterized primitives, and existing commands. It cannot access files, network or the host. Limits: 16000 source characters, 250ms interpreter time, 16MiB heap and 200 commands.",
    ].join(" "),
    permission: "propose",
    parameters: z.object({ ...parameters, summary: z.string().min(1).max(300) }).strict(),
    execute: async ({ source, inspection, summary }, context) => {
      bridge.assertConnection(context.userId, context.projectId, context.clientId);
      const scene = await bridge.getContext(context.clientId, inspection);
      if (inspection && scene.meshInspection?.status !== "ok") return { status: "rejected", message: scene.meshInspection?.message ?? "Mesh inspection unavailable", sourceRevision: scene.revision };
      let commands;
      try {
        commands = await generateCommands(source, scene, context.signal);
      } catch (error) {
        context.signal.throwIfAborted();
        return { status: "rejected", message: error instanceof Error ? error.message.slice(0, 2000) : "Program failed", sourceRevision: scene.revision };
      }
      const issues = validateAgainstContext(commands, scene);
      if (issues.length) return { status: "rejected", sourceRevision: scene.revision, issues };
      const proposal = await proposals.propose(
        { id: context.runId, userId: context.userId, projectId: context.projectId, clientId: context.clientId },
        { summary, commands, expectedRevision: scene.revision },
      );
      context.events.emit("editor.proposal.created", {
        proposalId: proposal.id, summary: proposal.summary, requiresApproval: proposal.requiresApproval,
        commandCount: proposal.commands.length, baseRevision: proposal.baseRevision, supersedes: null, planStepId: null,
      });
      return { proposalId: proposal.id, status: proposal.status, summary: proposal.summary, requiresApproval: proposal.requiresApproval, commandCount: proposal.commands.length, baseRevision: proposal.baseRevision };
    },
  })];
}
