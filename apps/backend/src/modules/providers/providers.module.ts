import { Module } from "@nestjs/common";
import { ProvidersService } from "./providers.service.js";
import { ProvidersController } from "./providers.controller.js";
import { ProviderTransport } from "./provider-transport.js";
import {
  SECRET_PROTECTOR,
  WindowsSecretProtector,
} from "./secret-protector.js";
@Module({
  controllers: [ProvidersController],
  providers: [
    ProvidersService,
    ProviderTransport,
    { provide: SECRET_PROTECTOR, useClass: WindowsSecretProtector },
  ],
  exports: [ProvidersService, ProviderTransport],
})
export class ProvidersModule {}
