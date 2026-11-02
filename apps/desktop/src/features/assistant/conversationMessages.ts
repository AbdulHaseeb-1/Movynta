import type { ChatMessage, MessageState } from "./types";

/** One saved request and its reply, as the backend keeps them. */
export interface SavedExchange {
  runId: string;
  prompt: string;
  reply?: string | undefined;
  status:
    | "created"
    | "running"
    | "waiting_approval"
    | "completed"
    | "failed"
    | "cancelled";
  error?: string | undefined;
  createdAt: string;
}

const REPLY_STATE: Readonly<Record<SavedExchange["status"], MessageState>> = {
  completed: "done",
  failed: "error",
  cancelled: "cancelled",
  // The backend ends interrupted runs on restart, so these only appear for a run that was cut short.
  created: "cancelled",
  running: "cancelled",
  waiting_approval: "cancelled",
};

/**
 * Rebuilds the chat transcript of a reopened project from its saved requests. The step-by-step
 * activity of each reply is not kept, so replies show their final text only.
 */
export function savedExchangesToMessages(
  exchanges: readonly SavedExchange[],
): ChatMessage[] {
  return exchanges.flatMap((exchange) => {
    const startedAt = Date.parse(exchange.createdAt) || Date.now();
    const state = REPLY_STATE[exchange.status];
    const reply = exchange.reply?.trim() ?? "";
    const user: ChatMessage = {
      id: `${exchange.runId}-request`,
      role: "user",
      content: exchange.prompt,
      state: "done",
      activity: [],
      startedAt,
    };
    const assistant: ChatMessage = {
      id: exchange.runId,
      role: "assistant",
      content: reply,
      state,
      activity: [],
      startedAt,
      ...(state === "error"
        ? { error: exchange.error ?? "The request failed." }
        : {}),
    };
    return [user, assistant];
  });
}
