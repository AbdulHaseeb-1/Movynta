import { Global, Module } from "@nestjs/common";
import { loadAppConfig, type AppConfig } from "./configuration.js";

export const APP_CONFIG = Symbol("APP_CONFIG");

/** Makes the validated application configuration injectable under `APP_CONFIG`. */
@Global()
@Module({
  providers: [{ provide: APP_CONFIG, useFactory: (): AppConfig => loadAppConfig(process.env) }],
  exports: [APP_CONFIG],
})
export class AppConfigModule {}
