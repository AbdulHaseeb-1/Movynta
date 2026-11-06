import { z } from "zod";
import type { AgentRunEventPayloads, AgentRunEventType } from "./agent-runs.types.js";

/**
 * One schema per event type. The mapped type forces an entry for every type in
 * AGENT_RUN_EVENT_TYPES, and each schema must match its payload type.
 */
const eventPayloadSchemas: { readonly [K in AgentRunEventType]: z.ZodType<AgentRunEventPayloads[K]> } = {
  "run.started": z.object({
    runId: z.string(),
    sessionId: z.string(),
    agentId: z.string(),
    selectedSkillIds: z.array(z.string()),
  }),
  "agent.started": z.object({ agentName: z.string() }),
  "agent.message.delta": z.object({ delta: z.string() }),
  "agent.message.completed": z.object({ text: z.string() }),
  "agent.continued": z.object({
    attempt: z.number().int().positive(),
    reasons: z.array(z.string()),
  }),
  "skill.loaded": z.object({ skillId: z.string(), version: z.string() }),
  "tool.started": z.object({ toolName: z.string(), permission: z.string() }),
  "tool.completed": z.object({ toolName: z.string(), durationMs: z.number() }),
  "tool.failed": z.object({ toolName: z.string(), message: z.string() }),
  "editor.proposal.created": z.object({
    proposalId: z.string(),
    summary: z.string(),
    requiresApproval: z.boolean(),
    commandCount: z.number().int().nonnegative(),
    baseRevision: z.number().int().nonnegative(),
    supersedes: z.string().nullable(),
    planStepId: z.string().nullable(),
  }),
  "viewport.captured": z.object({
    captureId: z.string(),
    views: z.array(z.object({ label: z.string(), width: z.number().int().positive(), height: z.number().int().positive() })),
    imagesSent: z.boolean(),
  }),
  "approval.required": z.object({
    approvalId: z.string(),
    toolName: z.string(),
    summary: z.string(),
    requiresApproval: z.literal(true),
  }),
  "approval.resolved": z.object({ approvalId: z.string(), decision: z.enum(["approve", "reject"]) }),
  "run.completed": z.object({ usage: z.number() }),
  "run.failed": z.object({ code: z.string(), message: z.string() }),
  "run.cancelled": z.object({ runId: z.string() }),
};

/** Checks a stored payload against the shape for its event type. Throws if the stored JSON does not match. */
export function parseEventPayload<T extends AgentRunEventType>(type: T, value: unknown): AgentRunEventPayloads[T] {
  return eventPayloadSchemas[type].parse(value);
}
