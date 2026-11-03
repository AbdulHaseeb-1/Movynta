import { z } from "zod";
import type { EditorToolDependencies } from "../editor/editor.types.js";
import { validateAgainstContext } from "../../editor-bridge/proposals/command-proposal.service.js";
import { defineTool, type ToolDefinition } from "../tool.types.js";
import { generateCommands, MAX_PROGRAM_CHARACTERS } from "./procedural.runner.js";

/** Computation only: generated commands still go through propose_commands and apply_proposal. */
export function createProceduralTools({ bridge }: Pick<EditorToolDependencies, "bridge">): ToolDefinition[] {
  return [defineTool({
    name: "modeling.generate_commands",
    description: [
      "Run a synchronous JavaScript function body to calculate editor commands for procedural modeling (loops, arrays, math).",
      "The argument scene is a JSON snapshot with revision, objects, selection, transforms and world bounds when available.",
      "Return an array of 1–200 commands using the editor.propose_commands command schema, with unique commandId values.",
      "Example: return Array.from({length: 5}, (_, i) => ({commandId: 'move_' + i, type: 'scene.transform_object', objectId: scene.selectedObjectIds[i], transform: {position: [i * 2, 0, 0]}}));",
      "No imports, host access, files, network, timers or async work. Limits: 16000 source characters, 250ms interpreter time, 16MiB guest heap.",
      "Nothing is applied or proposed. Submit successful commands to editor.propose_commands with expectedRevision equal to sourceRevision, then editor.apply_proposal.",
      "Use direct commands for simple edits. This tool supports only the existing editor operations, not arbitrary meshes or materials.",
    ].join(" "),
    permission: "read",
    parameters: z.object({ source: z.string().min(1).max(MAX_PROGRAM_CHARACTERS) }).strict(),
    execute: async ({ source }, context) => {
      bridge.assertConnection(context.userId, context.projectId, context.clientId);
      const scene = await bridge.getContext(context.clientId);
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
  })];
}
