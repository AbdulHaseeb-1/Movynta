import { ApiProperty } from "@nestjs/swagger";
import { IsIn } from "class-validator";
import { PROVIDER_IDS, type ProviderId } from "../providers.types.js";

/** The request body that makes a provider the active one. */
export class SelectProviderDto {
  @ApiProperty({ enum: [...PROVIDER_IDS], description: "The provider to make active." })
  @IsIn(PROVIDER_IDS)
  id!: ProviderId;
}
