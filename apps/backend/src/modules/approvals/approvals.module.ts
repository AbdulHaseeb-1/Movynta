import { Module } from "@nestjs/common";
import { AgentRunStorageModule } from "../agent-runs/agent-run-storage.module.js";
import { ApprovalPolicy } from "./approval.policy.js";
import { ApprovalsRepository } from "./approvals.repository.js";
import { ApprovalsService } from "./approvals.service.js";

@Module({
  imports: [AgentRunStorageModule],
  providers: [ApprovalPolicy, ApprovalsRepository, ApprovalsService],
  exports: [ApprovalPolicy, ApprovalsService],
/** The approvals feature: records and decides the approvals a run waits for. */
})
export class ApprovalsModule {}
