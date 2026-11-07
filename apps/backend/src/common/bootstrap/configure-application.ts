import { ValidationPipe, VersioningType, type INestApplication } from "@nestjs/common";
import type { NodeAdapter } from "@nestjs/platform-node";
import { WsAdapter } from "@nestjs/platform-ws";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { base64Length, MAX_ATTACHMENT_TOTAL_BYTES } from "@movynta/contracts";
import type { AppConfig } from "../../config/config.types.js";
import { MAX_ASSET_BYTES } from "../../modules/projects/projects.types.js";

const HEALTH_ROUTES = ["health/live", "health/ready"];
/** The one route that takes a binary body: a model file sent to a project. */
const MODEL_UPLOAD_PATH = /^\/api\/v1\/projects\/[^/?]+\/assets(\?|$)/;

/** The one JSON route whose body can hold pictures: a new agent run. */
const RUN_CREATE_PATH = /^\/api\/v1\/agent-runs(\?|$)/;
/** Room for the most pictures a request may carry as base64 text, plus the message and the rest of the request. */
const RUN_CREATE_BODY_LIMIT = base64Length(MAX_ATTACHMENT_TOTAL_BYTES) + 256 * 1024;

/**
 * Applies the HTTP and WebSocket configuration shared by the server and the
 * integration tests: `/api` prefix, URI versioning, validation, CORS, body
 * limits, WebSockets, and Swagger. Call before the application starts listening.
 */
export function configureApplication(app: INestApplication, adapter: NodeAdapter, config: AppConfig): void {
  // A run may carry pictures, so its request gets a larger limit. A parser skips a body that another already read.
  adapter.useBodyParser("json", false, {
    limit: RUN_CREATE_BODY_LIMIT,
    type: (request) =>
      request.method === "POST" &&
      RUN_CREATE_PATH.test(request.url ?? "") &&
      (request.headers["content-type"] ?? "").toLowerCase().startsWith("application/json"),
  });
  adapter.useBodyParser("json", false, { limit: config.requestBodyLimit });
  // Large bodies are read only for model uploads, so no other route can be sent megabytes.
  adapter.useBodyParser("raw", false, {
    limit: MAX_ASSET_BYTES,
    type: (request) =>
      request.method === "POST" &&
      MODEL_UPLOAD_PATH.test(request.url ?? "") &&
      (request.headers["content-type"] ?? "").startsWith("application/octet-stream"),
  });
  app.setGlobalPrefix("api", { exclude: HEALTH_ROUTES });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, validationError: { target: false, value: false } }));
  app.enableCors({
    origin: config.corsOrigins.length > 0 ? [...config.corsOrigins] : false,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
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
