import { z } from "zod";
import type { EditorScene } from "./EditorScene";

/** A batch the backend asks the editor to run. `phase` is set when the editor prepares a change before committing it. */
export const executionSchema = z.object({
  requestId: z.string(),
  proposalId: z.string(),
  expectedRevision: z.number().int(),
  commands: z.unknown(),
  phase: z.enum(["prepare", "commit", "discard"]).optional(),
});
export type ExecutionRequest = z.infer<typeof executionSchema>;

/** Runs a batch, turning a batch the editor cannot even parse into a failed result. */
export function executeSafely(editor: EditorScene, request: ExecutionRequest) {
  try {
    if (request.phase)
      return editor.executePrepared(request.proposalId, request.expectedRevision, request.commands, request.phase);
    return editor.execute(request.proposalId, request.expectedRevision, request.commands);
  } catch {
    return {
      status: "failed" as const,
      results: [],
      message: "The editor could not read this command batch",
    };
  }
}
