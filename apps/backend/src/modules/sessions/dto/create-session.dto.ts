import { ApiProperty } from "@nestjs/swagger";
import { IsString, Length, Matches } from "class-validator";

export const PROJECT_ID_PATTERN = /^[A-Za-z0-9._:-]+$/;

export class CreateSessionDto {
  @ApiProperty({ example: "project-1", maxLength: 128 })
  @IsString()
  @Length(1, 128)
  @Matches(PROJECT_ID_PATTERN)
  projectId!: string;
}

export class SessionResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() projectId!: string;
  @ApiProperty() createdAt!: string;
}
