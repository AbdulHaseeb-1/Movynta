import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsBoolean, IsOptional, IsString, Length, Matches } from "class-validator";

export class SaveProviderDto {
  @ApiProperty({ example: "gpt-5", maxLength: 160, description: "The model name the provider accepts." })
  @IsString()
  @Length(1, 160)
  @Matches(/^[A-Za-z0-9._:/-]+$/)
  model!: string;

  @ApiPropertyOptional({ description: "Leave empty to keep the saved API key." })
  @IsOptional()
  @IsString()
  @Length(1, 4096)
  apiKey?: string;

  @ApiPropertyOptional({ maxLength: 2048, description: "Leave empty to use the provider default endpoint." })
  @IsOptional()
  @IsString()
  @Length(1, 2048)
  baseUrl?: string;

  @ApiPropertyOptional({ default: true, description: "Whether the endpoint accepts image parts." })
  @IsOptional()
  @IsBoolean()
  acceptsImages?: boolean;
}
