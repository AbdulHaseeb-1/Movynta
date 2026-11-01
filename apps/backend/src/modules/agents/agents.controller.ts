import { Controller, Get, Param } from "@nestjs/common";
import { ApiBearerAuth, ApiNotFoundResponse, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { AgentRegistry } from "./agent.registry.js";
import type { AgentSummary } from "./definitions/definitions.types.js";

@ApiTags("agents")
@ApiBearerAuth()
@Controller({ path: "agents", version: "1" })
export class AgentsController {
  constructor(private readonly agents: AgentRegistry) {}

  @Get()
  @ApiOkResponse({ description: "Registered agents." })
  list(): AgentSummary[] {
    return this.agents.list();
  }

  @Get(":agentId")
  @ApiOkResponse({ description: "One registered agent." })
  @ApiNotFoundResponse({ description: "Unknown agent id." })
  get(@Param("agentId") agentId: string): AgentSummary {
    return this.agents.summary(agentId);
  }
}
