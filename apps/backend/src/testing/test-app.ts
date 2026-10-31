import { resolve } from "node:path";
import type { INestApplication } from "@nestjs/common";
import { NodeAdapter } from "@nestjs/platform-node";
import { Test } from "@nestjs/testing";
import { ScriptedModel } from "@openai/agents/testing";
import type { AddressInfo } from "node:net";
import { AppModule } from "../app.module.js";
import { configureApplication } from "../common/bootstrap/configure-application.js";
import { loadAppConfig } from "../config/configuration.js";
import { MODEL_PROVIDER } from "../modules/agents/agent.tokens.js";
import { signToken } from "../modules/auth/token.js";
import { TEST_AUTH_SECRET } from "./constants.js";

export { TEST_AUTH_SECRET };

function isListeningServer(value: unknown): value is { address(): AddressInfo | string | null } {
  return typeof value === "object" && value !== null && "address" in value && typeof value.address === "function";
}

export interface TestServer {
  readonly app: INestApplication;
  readonly baseUrl: string;
  readonly wsUrl: string;
  readonly model: ScriptedModel;
  /** Bearer token for a user id, valid for one hour. */
  token(userId: string): string;
  close(): Promise<void>;
}

/**
 * Boots the real application against an in-memory database. Only the model
 * provider is replaced, with the SDK's scripted model, so no network calls happen.
 */
export async function startTestServer(): Promise<TestServer> {
  process.env["NODE_ENV"] = "test";
  process.env["AUTH_SECRET"] = TEST_AUTH_SECRET;
  process.env["DATABASE_URL"] = ":memory:";
  process.env["SKILLS_DIR"] = resolve(process.cwd(), "../../skills");
  process.env["CORS_ORIGINS"] = "http://localhost:1420";
  process.env["AGENTS_ENABLED"] = "true";
  process.env["OPENAI_MODEL"] = "test-model";
  process.env["EDITOR_REQUEST_TIMEOUT_MS"] = "3000";
  process.env["AGENT_RUN_TIMEOUT_MS"] = "20000";
  process.env["RATE_LIMIT_PER_MINUTE"] = "10000";
  const config = loadAppConfig(process.env);

  const model = new ScriptedModel();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MODEL_PROVIDER)
    .useValue({ getModel: () => model })
    .compile();

  const adapter = new NodeAdapter();
  const app = moduleRef.createNestApplication(adapter);
  configureApplication(app, adapter, config);
  await app.listen(0, "127.0.0.1");

  const httpServer: unknown = app.getHttpServer();
  if (!isListeningServer(httpServer)) throw new Error("Test server is not a Node HTTP server");
  const address = httpServer.address();
  if (address === null || typeof address === "string") throw new Error("Test server has no TCP address");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    app,
    baseUrl,
    wsUrl: `ws://127.0.0.1:${address.port}/api/v1/editor/ws`,
    model,
    token: (userId: string) => signToken(userId, TEST_AUTH_SECRET, 3600),
    close: () => app.close(),
  };
}
