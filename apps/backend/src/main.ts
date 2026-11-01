import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { NodeAdapter } from "@nestjs/platform-node";
import { AppModule } from "./app.module.js";
import { configureApplication } from "./common/bootstrap/configure-application.js";
import { loadAppConfig } from "./config/configuration.js";
import { prepareDesktopConnection } from "./common/bootstrap/desktop-connection.js";
import { APP_CONFIG } from "./config/config.module.js";
import type { AppConfig } from "./config/config.types.js";

async function bootstrap(): Promise<void> {
  // Validate configuration before Nest starts, so a bad environment fails with a readable message.
  const connection = await prepareDesktopConnection();
  const config = loadAppConfig(process.env);
  if (config.host !== "127.0.0.1" || config.port !== 3001)
    throw new Error("Desktop backend must bind to 127.0.0.1:3001");
  const adapter = new NodeAdapter();
  const app = await NestFactory.create(AppModule, adapter, {
    bufferLogs: false,
  });
  configureApplication(app, adapter, config);
  await app.listen(config.port, config.host);
  const effectiveConfig = app.get<AppConfig>(APP_CONFIG);
  await connection.publish(effectiveConfig.auth.secret);
  const rotation = setInterval(
    () => {
      void connection
        .publish(effectiveConfig.auth.secret)
        .catch(() =>
          new Logger("Bootstrap").warn("Could not refresh desktop connection"),
        );
    },
    60 * 60 * 1000,
  );
  rotation.unref();
  new Logger("Bootstrap").log(
    `Movynta backend listening on http://${config.host}:${config.port}`,
  );
}

await bootstrap();
