import { ValidationPipe, VersioningType, type INestApplication } from "@nestjs/common";
import type { NodeAdapter } from "@nestjs/platform-node";
import { WsAdapter } from "@nestjs/platform-ws";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import type { AppConfig } from "../../config/configuration.js";

const HEALTH_ROUTES = ["health/live", "health/ready"];

/**
 * Applies the HTTP and WebSocket configuration shared by the server and the
 * integration tests: `/api` prefix, URI versioning, validation, CORS, body
 * limits, WebSockets, and Swagger. Call before the application starts listening.
 */
export function configureApplication(app: INestApplication, adapter: NodeAdapter, config: AppConfig): void {
  adapter.useBodyParser("json", false, { limit: config.requestBodyLimit });
  app.setGlobalPrefix("api", { exclude: HEALTH_ROUTES });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.enableCors({
    origin: config.corsOrigins.length > 0 ? [...config.corsOrigins] : false,
    methods: ["GET", "POST", "DELETE", "OPTIONS"],
    credentials: false,
  });
  app.useWebSocketAdapter(new WsAdapter(app));

  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle("Movynta AI backend")
      .setDescription("Agent runs, approvals, sessions, skills, and editor bridge for Movynta.")
      .setVersion("1.0.0")
      .addBearerAuth()
      .build(),
  );
  SwaggerModule.setup("api/docs", app, document);
}
