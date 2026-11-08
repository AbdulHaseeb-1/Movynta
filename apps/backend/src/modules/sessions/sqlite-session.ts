import type { AgentInputItem, Session } from "@openai/agents";
import { DatabaseService } from "../persistence/database.service.js";
import { integerColumn, textColumn } from "../persistence/row.js";
import type { SqlRow } from "../persistence/persistence.types.js";

/**
 * Stored items are JSON written by this service from SDK items. A cheap shape
 * check guards against corrupted rows before they reach the SDK.
 */
function isStoredItem(value: unknown): value is AgentInputItem {
  return typeof value === "object" && value !== null && ("type" in value || "role" in value);
}

const IMAGE_PLACEHOLDER =
  "[An image was shown here. Images are not kept in the conversation history; capture the view again to see it.]";
const ATTACHMENT_PLACEHOLDER =
  "[The image the user attached here is not kept in the conversation history. Ask the user to attach it again if you need to look at it.]";

/**
 * Pictures are base64 text, and the whole history is sent to the model on every later turn. They are kept for the
 * run that received them, but not in the stored history, where each would grow it by hundreds of kilobytes. The
 * text next to them is kept, so the conclusions, measurements and the names of attached images stay.
 * This covers the pictures a tool returned and the ones the user attached to a message.
 */
export function withoutImages(item: AgentInputItem): AgentInputItem {
  if ("type" in item && item.type === "function_call_result" && Array.isArray(item.output)) {
    const output = item.output.map((part) =>
      part.type === "input_image" ? { type: "input_text" as const, text: IMAGE_PLACEHOLDER } : part,
    );
    return { ...item, output };
  }
  if ("role" in item && item.role === "user" && Array.isArray(item.content)) {
    if (!item.content.some((part) => part.type === "input_image")) return item;
    const content = item.content.map((part) =>
      part.type === "input_image" ? { type: "input_text" as const, text: ATTACHMENT_PLACEHOLDER } : part,
    );
    return { ...item, content };
  }
  return item;
}

function parseItem(row: SqlRow): AgentInputItem {
  const parsed: unknown = JSON.parse(textColumn(row, "item_json"));
  if (!isStoredItem(parsed)) throw new Error("Stored session item is malformed");
  return parsed;
}

/**
 * Persistent conversation history for one session, stored in SQLite.
 * Items are JSON produced by the SDK and stored by this service only.
 */
export class SqliteSession implements Session {
  constructor(
    private readonly database: DatabaseService,
    private readonly sessionId: string,
  ) {}

  async getSessionId(): Promise<string> {
    return this.sessionId;
  }

  async getItems(limit?: number): Promise<AgentInputItem[]> {
    const db = this.database.db;
    const rows =
      limit === undefined
        ? db.prepare("SELECT item_json FROM session_items WHERE session_id = ? ORDER BY seq ASC").all(this.sessionId)
        : db
            .prepare(
              `SELECT item_json FROM (
                 SELECT seq, item_json FROM session_items WHERE session_id = ? ORDER BY seq DESC LIMIT ?
               ) ORDER BY seq ASC`,
            )
            .all(this.sessionId, limit);
    return rows.map(parseItem);
  }

  async addItems(items: AgentInputItem[]): Promise<void> {
    if (items.length === 0) return;
    this.database.transaction((db) => {
      const current = db
        .prepare("SELECT COALESCE(MAX(seq), 0) AS max_seq FROM session_items WHERE session_id = ?")
        .get(this.sessionId);
      if (!current) throw new Error("Failed to read session history position");
      let seq = integerColumn(current, "max_seq");
      const insert = db.prepare("INSERT INTO session_items (session_id, seq, item_json) VALUES (?, ?, ?)");
      for (const item of items) {
        seq += 1;
        insert.run(this.sessionId, seq, JSON.stringify(withoutImages(item)));
      }
    });
  }

  async popItem(): Promise<AgentInputItem | undefined> {
    return this.database.transaction((db) => {
      const last = db
        .prepare("SELECT seq, item_json FROM session_items WHERE session_id = ? ORDER BY seq DESC LIMIT 1")
        .get(this.sessionId);
      if (!last) return undefined;
      db.prepare("DELETE FROM session_items WHERE session_id = ? AND seq = ?").run(
        this.sessionId,
        integerColumn(last, "seq"),
      );
      return parseItem(last);
    });
  }

  async clearSession(): Promise<void> {
    this.database.db.prepare("DELETE FROM session_items WHERE session_id = ?").run(this.sessionId);
  }
}
