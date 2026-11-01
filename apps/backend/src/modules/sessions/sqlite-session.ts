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
        insert.run(this.sessionId, seq, JSON.stringify(item));
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
