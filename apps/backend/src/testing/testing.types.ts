import type { INestApplication } from "@nestjs/common";
import type { ScriptedModel } from "@openai/agents/testing";
import type { z } from "zod";
import type { editorCommandListSchema } from "@movynta/editor-protocol";
import type { outboundSchema } from "./editor-simulator.js";
import type { envelopeSchema } from "./event-stream.js";

/** One event read from a test event stream. */
export interface StreamedEvent {
  readonly id: string | undefined;
  readonly type: string | undefined;
  readonly envelope: z.infer<typeof envelopeSchema>;
}

/** A test event stream: the events so far, and a way to wait for one that matches. */
export interface EventStream {
  readonly events: StreamedEvent[];
  waitFor(predicate: (event: StreamedEvent) => boolean, timeoutMs?: number): Promise<StreamedEvent>;
  stop(): void;
}

/** A running test server: its addresses, the simulated model, and a way to sign in as a user. */
export interface TestServer {
  readonly app: INestApplication;
  readonly baseUrl: string;
  readonly wsUrl: string;
  readonly model: ScriptedModel;
  /** Bearer token for a user id, valid for one hour. */
  token(userId: string): string;
  close(): Promise<void>;
}

/** A message the simulated editor receives. */
export type OutboundMessage = z.infer<typeof outboundSchema>;
/** A list of editor commands, as the schema reads it. */
export type EditorCommandList = z.infer<typeof editorCommandListSchema>;
/** One editor command. */
export type EditorCommand = EditorCommandList[number];
