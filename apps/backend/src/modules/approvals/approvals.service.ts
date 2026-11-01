import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { NotFoundError } from "../../common/errors/app-error.js";
import { AgentRunRepository } from "../agent-runs/agent-run.repository.js";
import type { AgentRunRecord } from "../agent-runs/agent-runs.types.js";
import { ApprovalsRepository } from "./approvals.repository.js";
import type { ApprovalDecision, ApprovalRecord, NewApproval } from "./approvals.types.js";

export const APPROVAL_TTL_MS = 10 * 60 * 1000;

/** Creates approval requests and exposes ownership-checked reads. Decisions run in AgentRunsService. */
@Injectable()
export class ApprovalsService {
  constructor(
    private readonly approvals: ApprovalsRepository,
    private readonly runs: AgentRunRepository,
  ) {}

  create(run: AgentRunRecord, request: NewApproval, now: Date = new Date()): ApprovalRecord {
    const record = {
      id: `apr_${randomUUID()}`,
      runId: run.id,
      userId: run.userId,
      callId: request.callId,
      toolName: request.toolName,
      preview: request.preview,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + APPROVAL_TTL_MS).toISOString(),
    };
    this.approvals.insert(record);
    return { ...record, status: "pending", reason: undefined, decidedAt: undefined };
  }

  listForRun(userId: string, runId: string): ApprovalRecord[] {
    this.requireOwnedRun(userId, runId);
    return this.approvals.listForRun(runId);
  }

  /** Returns the approval for a run, or 404 if it belongs to another run or user. */
  findForRun(runId: string, approvalId: string): ApprovalRecord {
    const approval = this.approvals.find(approvalId);
    if (!approval || approval.runId !== runId) throw new NotFoundError("Approval not found");
    return approval;
  }

  pendingCount(runId: string): number {
    return this.approvals.listForRun(runId).filter((approval) => approval.status === "pending").length;
  }

  /** Records a decision atomically. Returns false if it was already decided or expired. */
  record(approvalId: string, approved: boolean, reason: string | undefined, now: Date = new Date()): boolean {
    return this.approvals.decide(approvalId, approved ? "approved" : "rejected", reason, now.toISOString());
  }

  /** Expires approvals past their deadline. */
  expireDue(runId: string, now: Date = new Date()): void {
    this.approvals.expireDue(runId, now.toISOString());
  }

  /** Closes all pending approvals, used when the run is cancelled. */
  closePending(runId: string, now: Date = new Date()): void {
    this.approvals.closePending(runId, now.toISOString());
  }

  /** Decisions for every approval in the run, used when rebuilding an interrupted run. */
  decisionsFor(runId: string): ApprovalDecision[] {
    return this.approvals
      .listForRun(runId)
      .filter((approval) => approval.status === "approved" || approval.status === "rejected")
      .map((approval) => ({
        callId: approval.callId,
        approved: approval.status === "approved",
        reason: approval.reason,
      }));
  }

  private requireOwnedRun(userId: string, runId: string): AgentRunRecord {
    const run = this.runs.find(runId);
    if (!run || run.userId !== userId) throw new NotFoundError("Agent run not found");
    return run;
  }
}
