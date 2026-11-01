import type { z } from "zod";
import type { envSchema } from "./env.validation.js";

export interface McpServerConfig {
  readonly name: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly allowedTools: readonly string[];
}

export interface AppConfig {
  readonly nodeEnv: "development" | "test" | "production";
  readonly host: string;
  readonly port: number;
  readonly corsOrigins: readonly string[];
  readonly requestBodyLimit: string;
  readonly rateLimit: { readonly windowMs: number; readonly limit: number };
  readonly auth: { readonly secret: string; readonly tokenTtlSeconds: number };
  readonly database: { readonly path: string };
  readonly agents: {
    readonly enabled: boolean;
    readonly apiKey: string | undefined;
    readonly model: string | undefined;
    readonly tracingDisabled: boolean;
    readonly runTimeoutMs: number;
    readonly maxTurns: number;
  };
  readonly editor: { readonly requestTimeoutMs: number };
  readonly skills: { readonly directory: string };
  readonly mcp: { readonly enabled: boolean; readonly servers: readonly McpServerConfig[] };
  readonly blender: { readonly enabled: boolean };
}

export type RawEnv = z.infer<typeof envSchema>;
