import type { DatabaseSync } from "node:sqlite";
import type { AgentInputItem, Session } from "@openai/agents";
import { base64Length, MAX_ATTACHMENTS, MAX_ATTACHMENT_TOTAL_BYTES } from "@movynta/contracts";
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
  "[An image the user attached earlier is no longer kept: only the newest reference images are. Ask the user to attach it again if you need to look at it.]";
/** How a picture appears in a stored item. Only user messages can hold one: tool pictures are removed before storing. */
const INPUT_IMAGE_MARK = '"input_image"';

/** The most reference pictures the history keeps, counted from the newest. */
export const KEPT_REFERENCE_PICTURES = MAX_ATTACHMENTS;
/**
 * The most picture data, as base64 text, that the history keeps. It is a quarter of what one request may carry, so a
 * turn sends at most that much from the history on top of the pictures of its own request. It still holds one
 * picture of the largest size a request may carry.
 */
export const KEPT_REFERENCE_CHARS = base64Length(MAX_ATTACHMENT_TOTAL_BYTES / 4);

/**
 * A picture a tool drew (a view of the scene) can be drawn again whenever the model needs it, so the stored history
 * keeps only the text of a tool result, with a short note in place of each picture. The text next to them is kept.
 */
export function withoutToolPictures(item: AgentInputItem): AgentInputItem {
  if ("type" in item && item.type === "function_call_result" && Array.isArray(item.output)) {
    const output = item.output.map((part) =>
      part.type === "input_image" ? { type: "input_text" as const, text: IMAGE_PLACEHOLDER } : part,
    );
    return { ...item, output };
  }
  return item;
}

/**
 * The reference pictures the history keeps, counted from the newest, within KEPT_REFERENCE_PICTURES and
 * KEPT_REFERENCE_CHARS. Once a picture does not fit, it and every older one are outside the window. Pictures are taken
 * newest first and a picture never comes back, so the window only moves towards the past.
 */
export class ReferencePictureWindow {
  private pictures = 0;
  private chars = 0;
  private closed = false;

  /** Takes a picture into the window. Returns false, and closes the window, when the picture does not fit. */
  take(image: unknown): boolean {
    const fits =
      !this.closed &&
      typeof image === "string" &&
      this.pictures < KEPT_REFERENCE_PICTURES &&
      this.chars + image.length <= KEPT_REFERENCE_CHARS;
    if (!fits) {
      this.closed = true;
      return false;
    }
    this.pictures += 1;
    this.chars += image.length;
    return true;
  }
}

/**
 * The item with each of its pictures checked against the window: a picture outside it becomes a note. Within a
 * message the pictures are taken from the last to the first, so the newest stay. Returns the same item when none change.
 */
export function applyReferenceWindow(item: AgentInputItem, window: ReferencePictureWindow): AgentInputItem {
  if (!("role" in item) || item.role !== "user" || !Array.isArray(item.content)) return item;
  const content = [...item.content];
  let changed = false;
  for (let index = content.length - 1; index >= 0; index -= 1) {
    const part = content[index];
    if (part?.type !== "input_image" || window.take(part.image)) continue;
    content[index] = { type: "input_text" as const, text: ATTACHMENT_PLACEHOLDER };
    changed = true;
  }
  return changed ? { ...item, content } : item;
}

function parseItem(row: SqlRow): AgentInputItem {
  const parsed: unknown = JSON.parse(textColumn(row, "item_json"));
  if (!isStoredItem(parsed)) throw new Error("Stored session item is malformed");
  return parsed;
}

/**
 * Persistent conversation history for one session, stored in SQLite.
 * Items are JSON produced by the SDK and stored by this service only.
 *
 * The pictures a user attached are kept for later messages and later turns of the same run, because the assistant
 * cannot draw them again. Only the newest are kept (see KEPT_REFERENCE_PICTURES); the data of the rest is removed.
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
      let hasPictures = false;
      for (const item of items) {
        seq += 1;
        const json = JSON.stringify(withoutToolPictures(item));
        if (json.includes(INPUT_IMAGE_MARK)) hasPictures = true;
        insert.run(this.sessionId, seq, json);
      }
      if (hasPictures) this.releaseOldReferencePictures(db);
    });
  }

  /**
   * Replaces the reference pictures that are outside the window with a note, in storage as well as in what is read
   * back. A picture that leaves the window never returns, so its data is released rather than kept for nothing.
   */
  private releaseOldReferencePictures(db: DatabaseSync): void {
    const rows = db
      .prepare("SELECT seq, item_json FROM session_items WHERE session_id = ? AND item_json LIKE ? ORDER BY seq DESC")
      .all(this.sessionId, `%${INPUT_IMAGE_MARK}%`);
    const window = new ReferencePictureWindow();
    for (const row of rows) {
      const item = parseItem(row);
      const windowed = applyReferenceWindow(item, window);
      if (windowed === item) continue;
      db.prepare("UPDATE session_items SET item_json = ? WHERE session_id = ? AND seq = ?").run(
        JSON.stringify(windowed),
        this.sessionId,
        integerColumn(row, "seq"),
      );
    }
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
