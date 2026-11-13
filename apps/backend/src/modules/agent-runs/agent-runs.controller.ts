import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Sse,
  type MessageEvent,
} from "@nestjs/common";
import { ApiBearerAuth, ApiNotFoundResponse, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import type { Observable } from "rxjs";
import { CurrentUser } from "../../common/decorators/current-user.decorator.js";
import { ResourceIdPipe } from "../../common/pipes/resource-id.pipe.js";
import { APPROVAL_ID_PATTERN, RUN_ID_PATTERN, TOOL_OUTPUT_ID_PATTERN } from "../../shared/constants/resource-ids.js";
import type { AuthUser } from "../auth/auth.types.js";
import { AgentRunsService } from "./agent-runs.service.js";
import type {
  AgentRunAccepted,
  AgentRunView,
  ApprovalDecisionResult,
  ApprovalView,
  ToolOutputView,
} from "./agent-runs.types.js";
import { AgentRunAcceptedDto, CreateAgentRunDto, DecideApprovalDto } from "./dto/agent-run.dto.js";

const runIdPipe = new ResourceIdPipe(RUN_ID_PATTERN);
const approvalIdPipe = new ResourceIdPipe(APPROVAL_ID_PATTERN);
const toolOutputIdPipe = new ResourceIdPipe(TOOL_OUTPUT_ID_PATTERN);

/** HTTP endpoints for agent runs: start, read, stream events, cancel and decide approvals. The logic lives in AgentRunsService. */
@ApiTags("agent-runs")
@ApiBearerAuth()
@Controller({ path: "agent-runs", version: "1" })
export class AgentRunsController {
  constructor(private readonly runs: AgentRunsService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOkResponse({ type: AgentRunAcceptedDto, description: "The run was accepted and is executing." })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateAgentRunDto): AgentRunAccepted {
    return this.runs.create(user, dto);
  }

  @Get(":runId")
  @ApiOkResponse({ description: "Run status, final output, and usage." })
  @ApiNotFoundResponse({ description: "Run not found for this user." })
  get(@CurrentUser() user: AuthUser, @Param("runId", runIdPipe) runId: string): AgentRunView {
    return this.runs.get(user, runId);
  }

  /** Server-sent events. Send `Last-Event-ID` to resume after a known event. */
  @Sse(":runId/events")
  @ApiNotFoundResponse({ description: "Run not found for this user." })
  events(
    @CurrentUser() user: AuthUser,
    @Param("runId", runIdPipe) runId: string,
    @Headers("last-event-id") lastEventId: string | undefined,
  ): Observable<MessageEvent> {
    return this.runs.stream(user, runId, lastEventId);
  }

  @Post(":runId/cancel")
  @HttpCode(HttpStatus.ACCEPTED)
  cancel(@CurrentUser() user: AuthUser, @Param("runId", runIdPipe) runId: string): { runId: string; status: string } {
    return this.runs.cancel(user, runId);
  }

  /** The arguments and the full result of one tool call of the run, named by the `outputId` of its tool event. */
  @Get(":runId/tool-outputs/:outputId")
  @ApiOkResponse({ description: "What one tool call of the run received and returned." })
  @ApiNotFoundResponse({ description: "Run or tool output not found for this user." })
  toolOutput(
    @CurrentUser() user: AuthUser,
    @Param("runId", runIdPipe) runId: string,
    @Param("outputId", toolOutputIdPipe) outputId: string,
  ): ToolOutputView {
    return this.runs.toolOutput(user, runId, outputId);
  }

  @Get(":runId/approvals")
  @ApiOkResponse({ description: "Approval requests for the run." })
  listApprovals(@CurrentUser() user: AuthUser, @Param("runId", runIdPipe) runId: string): ApprovalView[] {
    return this.runs.listApprovals(user, runId);
  }

  @Post(":runId/approvals/:approvalId")
  @HttpCode(HttpStatus.OK)
  decideApproval(
    @CurrentUser() user: AuthUser,
    @Param("runId", runIdPipe) runId: string,
    @Param("approvalId", approvalIdPipe) approvalId: string,
    @Body() dto: DecideApprovalDto,
  ): ApprovalDecisionResult {
    return this.runs.decide(user, runId, approvalId, dto);
  }
}
