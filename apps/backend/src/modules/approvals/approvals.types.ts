import type { z } from "zod";
import type { approvalPreviewSchema } from "./approval.preview.js";
import type { APPROVAL_STATUSES } from "./approvals.repository.js";

/** What the user sees about a pending action before deciding it. */
export type ApprovalPreview = z.infer<typeof approvalPreviewSchema>;

/** The status of an approval. */
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

/** An approval as it is stored. */
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

/** The decision made on an approval. */
export interface ApprovalDecision {
  readonly callId: string;
  readonly approved: boolean;
  readonly reason: string | undefined;
}

/** What is needed to create an approval record. */
export interface NewApproval {
  readonly callId: string;
  readonly toolName: string;
  readonly preview: ApprovalPreview;
}
