import { Injectable } from "@nestjs/common";
import { DatabaseService } from "../persistence/database.service.js";
import { optionalTextColumn, textColumn } from "../persistence/row.js";
import type { SessionRecord } from "./sessions.types.js";

@Injectable()
export class SessionsRepository {
  constructor(private readonly database: DatabaseService) {}

  insert(record: Omit<SessionRecord, "deletedAt">): void {
    this.database
      .db.prepare("INSERT INTO sessions (id, user_id, project_id, created_at) VALUES (?, ?, ?, ?)")
      .run(record.id, record.userId, record.projectId, record.createdAt);
  }

  find(sessionId: string): SessionRecord | undefined {
    const row = this.database.db
      .prepare("SELECT id, user_id, project_id, created_at, deleted_at FROM sessions WHERE id = ?")
      .get(sessionId);
    if (!row) return undefined;
    return {
      id: textColumn(row, "id"),
      userId: textColumn(row, "user_id"),
      projectId: textColumn(row, "project_id"),
      createdAt: textColumn(row, "created_at"),
      deletedAt: optionalTextColumn(row, "deleted_at"),
    };
  }

  /** Soft-deletes the session and erases its stored history in one transaction. */
  markDeleted(sessionId: string, deletedAt: string): void {
    this.database.transaction((db) => {
      db.prepare("DELETE FROM session_items WHERE session_id = ?").run(sessionId);
      db.prepare("UPDATE sessions SET deleted_at = ? WHERE id = ?").run(deletedAt, sessionId);
    });
  }
}
