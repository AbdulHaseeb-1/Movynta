import { Module } from "@nestjs/common";
import { ApprovalsModule } from "../approvals/approvals.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { ProjectsModule } from "../projects/projects.module.js";
import { EDITOR_BRIDGE } from "./editor-bridge.tokens.js";
import { EditorBridgeGateway } from "./editor-bridge.gateway.js";
import { EditorBridgeService } from "./editor-bridge.service.js";
import { CommandProposalRepository } from "./proposals/command-proposal.repository.js";
import { CommandProposalService } from "./proposals/command-proposal.service.js";

@Module({
  imports: [AuthModule, ProjectsModule, ApprovalsModule],
  providers: [
    EditorBridgeService,
    { provide: EDITOR_BRIDGE, useExisting: EditorBridgeService },
    EditorBridgeGateway,
    CommandProposalRepository,
    CommandProposalService,
  ],
  exports: [EDITOR_BRIDGE, CommandProposalService],
/** Connects the backend to the desktop editor over a WebSocket. */
})
export class EditorBridgeModule {}
