import { Injectable } from "@nestjs/common";
import { DatabaseService } from "../persistence/database.service.js";
import { optionalTextColumn, textColumn } from "../persistence/row.js";
import type { SqlRow } from "../persistence/persistence.types.js";
import { requireOneOf } from "../../shared/guards/enum.guard.js";
import { approvalPreviewSchema } from "./approval.preview.js";
import type { ApprovalRecord } from "./approvals.types.js";

export const APPROVAL_STATUSES = ["pending", "approved", "rejected", "expired"] as const;

function toRecord(row: SqlRow): ApprovalRecord {
  return {
    id: textColumn(row, "id"),
    runId: textColumn(row, "run_id"),
    userId: textColumn(row, "user_id"),
    callId: textColumn(row, "call_id"),
    toolName: textColumn(row, "tool_name"),
    status: requireOneOf(APPROVAL_STATUSES, textColumn(row, "status"), "approval status"),
    preview: approvalPreviewSchema.parse(JSON.parse(textColumn(row, "preview_json"))),
    reason: optionalTextColumn(row, "reason"),
    createdAt: textColumn(row, "created_at"),
    expiresAt: textColumn(row, "expires_at"),
    decidedAt: optionalTextColumn(row, "decided_at"),
  };
}

@Injectable()
export class ApprovalsRepository {
  constructor(private readonly database: DatabaseService) {}

  insert(record: Omit<ApprovalRecord, "status" | "reason" | "decidedAt">): void {
    this.database
      .db.prepare(
        `INSERT INTO approvals (id, run_id, user_id, call_id, tool_name, status, preview_json, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
      )
      .run(
        record.id,
        record.runId,
        record.userId,
        record.callId,
        record.toolName,
        JSON.stringify(record.preview),
        record.createdAt,
        record.expiresAt,
      );
  }

  find(approvalId: string): ApprovalRecord | undefined {
    const row = this.database.db.prepare("SELECT * FROM approvals WHERE id = ?").get(approvalId);
    return row ? toRecord(row) : undefined;
  }

  listForRun(runId: string): ApprovalRecord[] {
    return this.database.db
      .prepare("SELECT * FROM approvals WHERE run_id = ? ORDER BY created_at ASC, id ASC")
      .all(runId)
      .map(toRecord);
  }

  /**
   * Moves a pending, unexpired approval to its decision in one conditional write.
   * Returns false when the approval was already decided, expired, or is unknown,
   * which makes approval consumption one-time.
   */
  decide(approvalId: string, status: "approved" | "rejected", reason: string | undefined, now: string): boolean {
    const result = this.database.db
      .prepare(
        `UPDATE approvals SET status = ?, reason = ?, decided_at = ?
         WHERE id = ? AND status = 'pending' AND expires_at > ?`,
      )
      .run(status, reason ?? null, now, approvalId, now);
    return Number(result.changes) === 1;
  }

  /** Expires pending approvals whose deadline has passed. */
  expireDue(runId: string, now: string): void {
    this.database.db
      .prepare("UPDATE approvals SET status = 'expired', decided_at = ? WHERE run_id = ? AND status = 'pending' AND expires_at <= ?")
      .run(now, runId, now);
  }

  /** Closes every pending approval for a run, for example when the run is cancelled. */
  closePending(runId: string, now: string): void {
    this.database.db
      .prepare("UPDATE approvals SET status = 'expired', decided_at = ? WHERE run_id = ? AND status = 'pending'")
      .run(now, runId);
  }
}
