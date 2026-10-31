import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsOptional, IsString, IsUUID, Length, Matches } from "class-validator";
import { PROJECT_ID_PATTERN } from "../../sessions/dto/create-session.dto.js";
import { MODELING_DIMENSIONS, type ModelingDimension } from "../../../shared/schemas/modeling-plan.schema.js";

export const AGENT_ID_PATTERN = /^[a-z][a-z0-9-]{1,63}$/;
export const CLIENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export class CreateAgentRunDto {
  @ApiProperty({ example: "project-1", maxLength: 128 })
  @IsString()
  @Length(1, 128)
  @Matches(PROJECT_ID_PATTERN)
  projectId!: string;

  @ApiPropertyOptional({ description: "Continue an existing session; omit to start a new one." })
  @IsOptional()
  @IsUUID()
  sessionId?: string;

  @ApiPropertyOptional({ example: "modeling-coordinator" })
  @IsOptional()
  @IsString()
  @Matches(AGENT_ID_PATTERN)
  agentId?: string;

  @ApiPropertyOptional({ description: "Editor connection id returned when the editor authenticated." })
  @IsOptional()
  @IsString()
  @Matches(CLIENT_ID_PATTERN)
  editorClientId?: string;

  @ApiProperty({ maxLength: 4000, example: "Create a stylised 3D robot with a round head." })
  @IsString()
  @Length(1, 4000)
  message!: string;

  @ApiPropertyOptional({ enum: MODELING_DIMENSIONS })
  @IsOptional()
  @IsIn([...MODELING_DIMENSIONS])
  dimension?: ModelingDimension;
}

export class DecideApprovalDto {
  @ApiProperty({ enum: ["approve", "reject"] })
  @IsIn(["approve", "reject"])
  decision!: "approve" | "reject";

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @Length(0, 500)
  reason?: string;
}

export class AgentRunAcceptedDto {
  @ApiProperty() runId!: string;
  @ApiProperty() sessionId!: string;
  @ApiProperty({ example: "running" }) status!: string;
  @ApiProperty() eventsUrl!: string;
}
