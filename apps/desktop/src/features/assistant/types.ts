import type { MessageAttachment } from "../attachments/types";

/** Who wrote a chat message. */
export type ChatRole = "user" | "assistant";

/** Where a chat message stands: still streaming, done, failed or cancelled. */
export type MessageState = "streaming" | "done" | "error" | "cancelled";

/** The kind of one step in a reply's work: a skill, a tool, a proposal, an approval or a review. */
export type ActivityKind = "skill" | "tool" | "proposal" | "approval" | "review";

/** Whether one step of the work is running, done or failed. */
export type ActivityStatus = "running" | "done" | "failed";

/** One visible step of the agent's work, shown in the activity timeline of a reply. */
export interface ActivityStep {
  id: string;
  kind: ActivityKind;
  /** Registry name of the tool, kept so completion events can find their start. */
  toolName?: string;
  label: string;
  detail?: string;
  status: ActivityStatus;
  durationMs?: number;
  /** Names the pictures the assistant looked at in this step, which the chat shows under it. */
  captureId?: string;
  /** Character position in the streamed reply when this step started. */
  contentOffset?: number;
}

/** One message of the chat, with the steps of its reply. */
export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  state: MessageState;
  activity: ActivityStep[];
  /** The pictures sent with a request. A reopened project lists their names only. */
  attachments?: MessageAttachment[];
  /** Set when the reply ended in an error; shown apart from the reply text. */
  error?: string;
  /** When the message was created, in epoch milliseconds. */
  startedAt: number;
  /** How long the agent took before its first visible output, once that has happened. */
  thinkingMs?: number;
}

/** Where the current run stands, from idle to completed, failed or cancelled. */
export type RunPhase = "idle" | "connecting" | "running" | "waiting_approval" | "completed" | "failed" | "cancelled";
