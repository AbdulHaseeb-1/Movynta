import { Module } from "@nestjs/common";
import { AgentRunEventsService } from "./agent-run-events.service.js";
import { AgentRunRepository } from "./agent-run.repository.js";

/** Shared run persistence and event publishing. Imported by runs, approvals, and editor modules. */
@Module({
  providers: [AgentRunRepository, AgentRunEventsService],
  exports: [AgentRunRepository, AgentRunEventsService],
})
export class AgentRunStorageModule {}
