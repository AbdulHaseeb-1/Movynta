import { z } from "zod";
import { editorCommandListSchema } from "../../shared/schemas/editor-command.schema.js";

/**
 * What an approver sees for a paused tool call. The processor builds it from stored
 * proposals, so it is never taken from model output alone.
 */
export const approvalPreviewSchema = z.object({
  toolName: z.string(),
  summary: z.string().optional(),
  proposalId: z.string().nullable().optional(),
  requiresApproval: z.boolean().optional(),
  commandCount: z.number().int().nonnegative().optional(),
  commands: editorCommandListSchema.optional(),
});
