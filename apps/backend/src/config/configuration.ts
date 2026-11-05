import { z } from "zod";
import type { AppConfig } from "./config.types.js";
import { envSchema } from "./env.validation.js";

export const MEMORY_DATABASE = ":memory:";

const mcpServersSchema = z.array(
  z.object({
    name: z.string().regex(/^[a-z][a-z0-9-]{1,40}$/),
    command: z.string().min(1),
    args: z.array(z.string()).default([]),
    allowedTools: z.array(z.string().min(1)).default([]),
  }),
);

/** Parses `DATABASE_URL` (`file:<path>` or `:memory:`) into a filesystem path. */
function parseDatabasePath(databaseUrl: string): string {
  if (databaseUrl === MEMORY_DATABASE) return MEMORY_DATABASE;
  if (databaseUrl.startsWith("file:")) {
    const path = databaseUrl.slice("file:".length);
    if (path.length > 0) return path;
  }
  throw new Error('DATABASE_URL must be "file:<path>" or ":memory:"');
}

/**
 * Builds the typed application configuration from raw environment variables.
 * Throws with a readable message when the environment is invalid.
 */
export function loadAppConfig(source: NodeJS.ProcessEnv): AppConfig {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => `${issue.path.join(".") || "env"}: ${issue.message}`).join("; ");
    throw new Error(`Invalid environment configuration: ${details}`);
  }

  const env = parsed.data;
  const servers = env.MCP_SERVERS_JSON ? mcpServersSchema.parse(JSON.parse(env.MCP_SERVERS_JSON)) : [];

  return {
    nodeEnv: env.NODE_ENV,
    host: env.HOST,
    port: env.PORT,
    corsOrigins: env.CORS_ORIGINS.split(",")
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
    requestBodyLimit: env.REQUEST_BODY_LIMIT,
    rateLimit: { windowMs: 60_000, limit: env.RATE_LIMIT_PER_MINUTE },
    auth: { secret: env.AUTH_SECRET, tokenTtlSeconds: env.AUTH_TOKEN_TTL_SECONDS },
    database: { path: parseDatabasePath(env.DATABASE_URL) },
    agents: {
      enabled: env.AGENTS_ENABLED,
      apiKey: env.OPENAI_API_KEY,
      model: env.OPENAI_MODEL,
      tracingDisabled: env.OPENAI_AGENTS_DISABLE_TRACING,
      runTimeoutMs: env.AGENT_RUN_TIMEOUT_MS,
      runIdleTimeoutMs: env.AGENT_RUN_IDLE_TIMEOUT_MS,
      continuationLimit: env.AGENT_CONTINUATION_LIMIT,
      maxTurns: env.AGENT_MAX_TURNS,
    },
    editor: { requestTimeoutMs: env.EDITOR_REQUEST_TIMEOUT_MS },
    skills: { directory: env.SKILLS_DIR },
    mcp: { enabled: env.MCP_ENABLED, servers },
    blender: { enabled: env.BLENDER_ENABLED },
  };
}
