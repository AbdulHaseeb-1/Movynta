import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { MAX_COMMANDS_PER_PROPOSAL } from "@movynta/editor-protocol";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsDefined,
  Min,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from "class-validator";

/** The direction of one undo or redo step in a project's scene history. */
export class SceneHistoryDto {
  @IsDefined() @IsIn(["undo", "redo"]) declare direction: "undo" | "redo";
}
/** A committed undo or redo. The version is the scene version it was based on; the operation id makes a retry safe. */
export class CommitSceneHistoryDto extends SceneHistoryDto {
  @IsDefined() @IsInt() @Min(0) declare version: number;
  @IsDefined() @IsString() @Matches(/^[A-Za-z0-9_-]{1,64}$/) declare operationId: string;
}
import {
  ASSET_FORMATS,
  PROJECT_CATEGORIES,
  PROJECT_NAME_MAX_LENGTH,
  PROJECT_SCOPES,
  PROJECT_SORTS,
  type AssetFormat,
  type ProjectCategory,
  type ProjectScope,
  type ProjectSort,
} from "../projects.types.js";

/** Describes the model file sent as the request body. */
export class ImportModelQueryDto {
  @ApiProperty({ description: "The file name, shown to the user." })
  @IsString()
  @Length(1, 160)
  name!: string;

  @ApiProperty({ enum: ASSET_FORMATS })
  @IsIn([...ASSET_FORMATS])
  format!: AssetFormat;

  @ApiProperty({ description: "The id the model gets in the scene." })
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{1,64}$/)
  objectId!: string;
}

/** The request body that records a manual scene edit as one step of the history. */
export class RecordSceneEditDto {
  @IsOptional() @IsString() @Matches(/^[A-Za-z0-9_-]{1,64}$/) declare actionId?: string;
  @ApiProperty({
    maxItems: MAX_COMMANDS_PER_PROPOSAL,
    description:
      "Manual transforms, deletion, modifier stacks and new primitives. A later transform can reference a primitive created in the same batch.",
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_COMMANDS_PER_PROPOSAL)
  commands!: unknown[];
}

/** The request body that creates a project. An empty name leaves it untitled. */
export class CreateProjectDto {
  @ApiPropertyOptional({ enum: PROJECT_CATEGORIES, default: "design" })
  @IsOptional()
  @IsIn([...PROJECT_CATEGORIES])
  category?: ProjectCategory;

  @ApiPropertyOptional({ maxLength: PROJECT_NAME_MAX_LENGTH, description: "Leave empty for an untitled project." })
  @IsOptional()
  @IsString()
  @MaxLength(PROJECT_NAME_MAX_LENGTH * 2)
  name?: string;
}

/** The request body that renames, stars or archives a project. Only the fields given are changed. */
export class UpdateProjectDto {
  @ApiPropertyOptional({
    maxLength: PROJECT_NAME_MAX_LENGTH,
    description: "An empty name makes the project untitled again.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(PROJECT_NAME_MAX_LENGTH * 2)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  starred?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  archived?: boolean;
}

/** The query that filters and sorts the project library. */
export class ListProjectsQueryDto {
  @ApiPropertyOptional({ description: "Matches project names and the requests made in them." })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  search?: string;

  @ApiPropertyOptional({ enum: PROJECT_CATEGORIES })
  @IsOptional()
  @IsIn([...PROJECT_CATEGORIES])
  category?: ProjectCategory;

  @ApiPropertyOptional({ enum: PROJECT_SCOPES, default: "active" })
  @IsOptional()
  @IsIn([...PROJECT_SCOPES])
  scope?: ProjectScope;

  @ApiPropertyOptional({ enum: ["true", "false"] })
  @IsOptional()
  @IsIn(["true", "false"])
  starred?: "true" | "false";

  @ApiPropertyOptional({ enum: PROJECT_SORTS, default: "updated" })
  @IsOptional()
  @IsIn([...PROJECT_SORTS])
  sort?: ProjectSort;
}
