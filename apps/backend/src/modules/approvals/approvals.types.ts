import type { z } from "zod";
import type { approvalPreviewSchema } from "./approval.preview.js";
import type { APPROVAL_STATUSES } from "./approvals.repository.js";

export type ApprovalPreview = z.infer<typeof approvalPreviewSchema>;

export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export interface ApprovalRecord {
  readonly id: string;
  readonly runId: string;
  readonly userId: string;
  readonly callId: string;
  readonly toolName: string;
  readonly status: ApprovalStatus;
  readonly preview: ApprovalPreview;
  readonly reason: string | undefined;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly decidedAt: string | undefined;
}

export interface ApprovalDecision {
  readonly callId: string;
  readonly approved: boolean;
  readonly reason: string | undefined;
}

export interface NewApproval {
  readonly callId: string;
  readonly toolName: string;
  readonly preview: ApprovalPreview;
}
