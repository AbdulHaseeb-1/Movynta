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
    /** Longest active time for one run, not counting waits for approval. */
    readonly runTimeoutMs: number;
    /** Longest time a run may go without any progress before it is stopped. */
    readonly runIdleTimeoutMs: number;
    /** How many times a run asks the model to carry on before it accepts the reply as final. */
    readonly continuationLimit: number;
    readonly maxTurns: number;
    /** Which runs are reviewed by a separate agent once their work is done. */
    readonly reviewMode: "off" | "quality" | "builds";
    /** Most independent reviews of one run. */
    readonly reviewLimit: number;
    /** Most model turns one review may take. */
    readonly reviewMaxTurns: number;
  };
  readonly editor: { readonly requestTimeoutMs: number };
  readonly skills: { readonly directory: string };
  readonly mcp: { readonly enabled: boolean; readonly servers: readonly McpServerConfig[] };
  readonly blender: { readonly enabled: boolean };
}

export type RawEnv = z.infer<typeof envSchema>;
