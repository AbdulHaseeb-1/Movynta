export type ChatRole = "user" | "assistant";

export type MessageState = "streaming" | "done" | "error" | "cancelled";

export type ActivityKind = "skill" | "tool" | "proposal" | "approval" | "review";

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

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  state: MessageState;
  activity: ActivityStep[];
  /** Set when the reply ended in an error; shown apart from the reply text. */
  error?: string;
  /** When the message was created, in epoch milliseconds. */
  startedAt: number;
  /** How long the agent took before its first visible output, once that has happened. */
  thinkingMs?: number;
}

export type RunPhase =
  | "idle"
  | "connecting"
  | "running"
  | "waiting_approval"
  | "completed"
  | "failed"
  | "cancelled";
