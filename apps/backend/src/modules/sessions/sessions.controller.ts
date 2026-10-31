import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiCreatedResponse, ApiNotFoundResponse, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator.js";
import type { AuthUser } from "../auth/auth.service.js";
import { CreateSessionDto, SessionResponseDto } from "./dto/create-session.dto.js";
import { SessionsService } from "./sessions.service.js";
import type { SessionRecord } from "./sessions.repository.js";

function toResponse(record: SessionRecord): SessionResponseDto {
  return { id: record.id, projectId: record.projectId, createdAt: record.createdAt };
}

@ApiTags("sessions")
@ApiBearerAuth()
@Controller({ path: "sessions", version: "1" })
export class SessionsController {
  constructor(private readonly sessions: SessionsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiCreatedResponse({ type: SessionResponseDto })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateSessionDto): SessionResponseDto {
    return toResponse(this.sessions.create(user.id, dto.projectId));
  }

  @Get(":sessionId")
  @ApiOkResponse({ type: SessionResponseDto })
  @ApiNotFoundResponse({ description: "Session not found for this user." })
  get(@CurrentUser() user: AuthUser, @Param("sessionId", ParseUUIDPipe) sessionId: string): SessionResponseDto {
    return toResponse(this.sessions.getOwned(user.id, sessionId));
  }

  @Delete(":sessionId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNotFoundResponse({ description: "Session not found for this user." })
  remove(@CurrentUser() user: AuthUser, @Param("sessionId", ParseUUIDPipe) sessionId: string): void {
    this.sessions.delete(user.id, sessionId);
  }
}
