import { z } from "zod";
import { backendRequest } from "@/lib/backend";

/** What one tool call of a run received and returned, as the backend keeps it. */
export const toolOutputSchema = z.object({
  id: z.string(),
  runId: z.string(),
  toolName: z.string(),
  input: z.string(),
  output: z.string(),
  outputBytes: z.number(),
  truncated: z.boolean(),
  createdAt: z.string(),
});

/** One stored tool output. */
export type ToolOutputRecord = z.infer<typeof toolOutputSchema>;

/** Reads the full record of one tool call of a run. Only the run's owner can read it. */
export function getToolOutput(runId: string, outputId: string, signal?: AbortSignal): Promise<ToolOutputRecord> {
  return backendRequest(`/agent-runs/${runId}/tool-outputs/${outputId}`, toolOutputSchema, "GET", undefined, signal);
}
