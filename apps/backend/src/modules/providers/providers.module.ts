import { Module } from "@nestjs/common";
import { ProvidersService } from "./providers.service.js";
import { ProvidersController } from "./providers.controller.js";
import { ChatgptAuthController } from "./chatgpt/chatgpt-auth.controller.js";
import { ChatgptAuthService } from "./chatgpt/chatgpt-auth.service.js";
import { ChatgptLoginRepository } from "./chatgpt/chatgpt-login.repository.js";
import { ChatgptModelCatalog } from "./chatgpt/chatgpt-model-catalog.js";
import { ChatgptOAuthClient } from "./chatgpt/chatgpt-oauth.client.js";
import { ProviderTransport } from "./provider-transport.js";
import { SECRET_PROTECTOR, WindowsSecretProtector } from "./secret-protector.js";
/** The providers feature: model provider settings and their credentials. */
@Module({
  controllers: [ProvidersController, ChatgptAuthController],
  providers: [
    ProvidersService,
    ChatgptAuthService,
    ChatgptLoginRepository,
    ChatgptModelCatalog,
    ChatgptOAuthClient,
    ProviderTransport,
    { provide: SECRET_PROTECTOR, useClass: WindowsSecretProtector },
  ],
  exports: [ProvidersService, ProviderTransport],
})
export class ProvidersModule {}
