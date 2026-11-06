import { Body, Controller, Delete, Get, Param, Post, Query } from "@nestjs/common";
import { CurrentUser } from "../../common/decorators/current-user.decorator.js";
import { ValidationFailedError } from "../../common/errors/app-error.js";
import type { AuthUser } from "../auth/auth.types.js";
import { ProbeProviderDto, SaveProviderDto, SelectProviderDto } from "./dto/index.js";
import { reasoningEffortsFor } from "./model-capabilities.js";
import { ProvidersService } from "./providers.service.js";
import { PROVIDER_IDS, type ProviderId } from "./providers.types.js";

function providerId(value: string): ProviderId {
  const id = PROVIDER_IDS.find((item) => item === value);
  if (!id) throw new ValidationFailedError("Unknown provider");
  return id;
}
@Controller({ path: "providers", version: "1" })
export class ProvidersController {
  constructor(private readonly providers: ProvidersService) {}
  @Get() list(@CurrentUser() user: AuthUser) {
    return this.providers.list(user.id);
  }
  /** What a model supports, so clients only offer settings that will be accepted. */
  @Get(":id/capabilities") capabilities(
    @Param("id") id: string,
    @Query("model") model?: string,
  ) {
    if (!model || model.length > 160 || !/^[A-Za-z0-9._:/-]+$/.test(model))
      throw new ValidationFailedError("A valid model is required");
    return { efforts: reasoningEffortsFor(providerId(id), model) };
  }
  @Post("active") activate(
    @CurrentUser() user: AuthUser,
    @Body() body: SelectProviderDto,
  ) {
    return this.providers.activate(user.id, body.id);
  }
  @Post(":id") save(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body() body: SaveProviderDto,
  ) {
    return this.providers.save(
      user.id,
      providerId(id),
      body.model,
      body.apiKey,
      body.baseUrl,
      body.acceptsImages,
    );
  }
  @Delete(":id") remove(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
  ) {
    return this.providers.remove(user.id, providerId(id));
  }
  @Post(":id/models") models(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body() body: ProbeProviderDto = {},
  ) {
    return this.providers.models(
      user.id,
      providerId(id),
      body.apiKey,
      body.baseUrl,
    );
  }
  @Post(":id/test")
  test(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body() body: ProbeProviderDto = {},
  ) {
    return this.providers.testConnection(user.id, providerId(id), body);
  }
}
