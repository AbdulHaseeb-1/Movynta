import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { NodeAdapter } from "@nestjs/platform-node";
import { AppModule } from "./app.module.js";
import { configureApplication } from "./common/bootstrap/configure-application.js";
import { loadAppConfig } from "./config/configuration.js";

async function bootstrap(): Promise<void> {
  // Validate configuration before Nest starts, so a bad environment fails with a readable message.
  const config = loadAppConfig(process.env);
  const adapter = new NodeAdapter();
  const app = await NestFactory.create(AppModule, adapter, { bufferLogs: false });
  configureApplication(app, adapter, config);
  await app.listen(config.port, config.host);
  new Logger("Bootstrap").log(`Movynta backend listening on http://${config.host}:${config.port}`);
}

await bootstrap();
