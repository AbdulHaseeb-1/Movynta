import type { INestApplication } from "@nestjs/common";
import type { ScriptedModel } from "@openai/agents/testing";
import type { z } from "zod";
import type { editorCommandListSchema } from "../shared/schemas/editor-command.schema.js";
import type { outboundSchema } from "./editor-simulator.js";
import type { envelopeSchema } from "./event-stream.js";

export interface StreamedEvent {
  readonly id: string | undefined;
  readonly type: string | undefined;
  readonly envelope: z.infer<typeof envelopeSchema>;
}

export interface EventStream {
  readonly events: StreamedEvent[];
  waitFor(predicate: (event: StreamedEvent) => boolean, timeoutMs?: number): Promise<StreamedEvent>;
  stop(): void;
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

export type OutboundMessage = z.infer<typeof outboundSchema>;
export type EditorCommandList = z.infer<typeof editorCommandListSchema>;
export type EditorCommand = EditorCommandList[number];
