import { Module } from "@nestjs/common";
import { AgentsModule } from "../agents/agents.module.js";
import { ApprovalsModule } from "../approvals/approvals.module.js";
import { EditorBridgeModule } from "../editor-bridge/editor-bridge.module.js";
import { ProjectsModule } from "../projects/projects.module.js";
import { SessionsModule } from "../sessions/sessions.module.js";
import { SkillsModule } from "../skills/skills.module.js";
import { AgentRunsController } from "./agent-runs.controller.js";
import { AgentRunsService } from "./agent-runs.service.js";
import { AgentRunProcessor } from "./agent-run.processor.js";
import { AgentRunStorageModule } from "./agent-run-storage.module.js";

@Module({
  imports: [
    AgentRunStorageModule,
    AgentsModule,
    ApprovalsModule,
    EditorBridgeModule,
    ProjectsModule,
    SessionsModule,
    SkillsModule,
  ],
  controllers: [AgentRunsController],
  providers: [AgentRunProcessor, AgentRunsService],
})
export class AgentRunsModule {}
