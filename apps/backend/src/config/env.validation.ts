import { z } from "zod";

const nodeEnvironments = ["development", "test", "production"] as const;

const durationMs = (fallback: number) => z.coerce.number().int().positive().default(fallback);

/**
 * Environment contract for the backend. Parsed once at startup so that a
 * missing or malformed value fails fast with a readable message.
 */
export const envSchema = z
  .object({
    NODE_ENV: z.enum(nodeEnvironments).default("development"),
    HOST: z.string().min(1).default("127.0.0.1"),
    PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    CORS_ORIGINS: z.string().default("http://localhost:1420"),
    REQUEST_BODY_LIMIT: z.string().min(1).default("256kb"),
    RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(120),

    AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 characters"),
    AUTH_TOKEN_TTL_SECONDS: durationMs(8 * 60 * 60),

    DATABASE_URL: z.string().min(1).default("file:./data/movynta.sqlite"),

    AGENTS_ENABLED: z.stringbool().default(true),
    OPENAI_API_KEY: z.string().min(1).optional(),
    OPENAI_MODEL: z.string().min(1).optional(),
    OPENAI_AGENTS_DISABLE_TRACING: z.stringbool().default(false),
    AGENT_RUN_TIMEOUT_MS: durationMs(5 * 60 * 1000),
    AGENT_MAX_TURNS: z.coerce.number().int().positive().default(12),

    EDITOR_REQUEST_TIMEOUT_MS: durationMs(15_000),
    SKILLS_DIR: z.string().min(1).default("../../skills"),

    MCP_ENABLED: z.stringbool().default(false),
    MCP_SERVERS_JSON: z.string().optional(),
    BLENDER_ENABLED: z.stringbool().default(false),
  })
  .superRefine((env, ctx) => {
    const requiresModel = env.AGENTS_ENABLED && env.NODE_ENV !== "test";
    if (requiresModel && !env.OPENAI_API_KEY) {
      ctx.addIssue({ code: "custom", path: ["OPENAI_API_KEY"], message: "OPENAI_API_KEY is required when AGENTS_ENABLED=true" });
    }
    if (requiresModel && !env.OPENAI_MODEL) {
      ctx.addIssue({ code: "custom", path: ["OPENAI_MODEL"], message: "OPENAI_MODEL is required when AGENTS_ENABLED=true" });
    }
  });

export type RawEnv = z.infer<typeof envSchema>;
