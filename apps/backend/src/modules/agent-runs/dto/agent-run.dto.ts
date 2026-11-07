import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  ATTACHMENT_MEDIA_TYPES,
  base64Length,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_NAME_LENGTH,
  MAX_ATTACHMENTS,
  type AttachmentMediaType,
} from "@movynta/contracts";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  ValidateNested,
} from "class-validator";
import { PROJECT_ID_PATTERN } from "../../sessions/dto/create-session.dto.js";
import { MODELING_DIMENSIONS } from "../../../shared/schemas/modeling-plan.schema.js";
import type { ModelingDimension } from "../../../shared/types/modeling-plan.types.js";
import { REASONING_EFFORTS, type ReasoningEffort } from "../../providers/model-capabilities.js";
import { PROVIDER_IDS, type ProviderId } from "../../providers/providers.types.js";

/** The allowed form of an agent id. */
export const AGENT_ID_PATTERN = /^[a-z][a-z0-9-]{1,63}$/;
/** The allowed form of an editor connection id. */
export const CLIENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** One picture attached to a request. The content is checked in full by `checkAttachments`. */
export class AttachmentDto {
  @ApiProperty({ maxLength: MAX_ATTACHMENT_NAME_LENGTH, example: "reference.png" })
  @IsString()
  @Length(1, MAX_ATTACHMENT_NAME_LENGTH)
  name!: string;

  @ApiProperty({ enum: ATTACHMENT_MEDIA_TYPES })
  @IsIn([...ATTACHMENT_MEDIA_TYPES])
  mediaType!: AttachmentMediaType;

  @ApiProperty({ description: "The picture's bytes as base64 text, without a data: prefix." })
  @IsString()
  @MaxLength(base64Length(MAX_ATTACHMENT_BYTES))
  @Length(4, base64Length(MAX_ATTACHMENT_BYTES))
  data!: string;
}

/** The request body for starting an agent run. It is checked before the run is created, and unknown fields are refused. */
export class CreateAgentRunDto {
  @IsOptional() @IsIn(PROVIDER_IDS) providerId?: ProviderId;
  @IsOptional() @IsString() @Length(1, 160) @Matches(/^[A-Za-z0-9._:/-]+$/) model?: string;
  @IsOptional() @IsIn([true, false]) useConfiguredProvider?: boolean;
  @ApiPropertyOptional({
    enum: REASONING_EFFORTS,
    description: "Reasoning effort; must be one the selected model supports.",
  })
  @IsOptional()
  @IsIn([...REASONING_EFFORTS])
  reasoningEffort?: ReasoningEffort;
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

  @ApiPropertyOptional({
    type: [AttachmentDto],
    description: `Pictures for the assistant to look at, at most ${MAX_ATTACHMENTS}.`,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ATTACHMENTS)
  @ValidateNested({ each: true })
  @Type(() => AttachmentDto)
  attachments?: AttachmentDto[];

  @ApiPropertyOptional({ enum: MODELING_DIMENSIONS })
  @IsOptional()
  @IsIn([...MODELING_DIMENSIONS])
  dimension?: ModelingDimension;
}

/** The request body that approves or rejects one pending approval of a run. */
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

/** The reply to starting a run: its id, its session, and the URL that streams its events. */
export class AgentRunAcceptedDto {
  @ApiProperty() runId!: string;
  @ApiProperty() sessionId!: string;
  @ApiProperty({ example: "running" }) status!: string;
  @ApiProperty() eventsUrl!: string;
}
