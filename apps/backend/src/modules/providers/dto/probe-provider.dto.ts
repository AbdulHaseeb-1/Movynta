import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString, Length } from "class-validator";

/** Directs a model listing or connection test without changing the saved provider. */
export class ProbeProviderDto {
  @ApiPropertyOptional({ description: "Leave empty to use the saved API key." })
  @IsOptional()
  @IsString()
  @Length(1, 4096)
  apiKey?: string;

  @ApiPropertyOptional({ maxLength: 160, description: "Leave empty to check the provider's saved model." })
  @IsOptional()
  @IsString()
  @Length(1, 160)
  model?: string;

  @ApiPropertyOptional({ maxLength: 2048, description: "Leave empty to use the provider default endpoint." })
  @IsOptional()
  @IsString()
  @Length(1, 2048)
  baseUrl?: string;
}
