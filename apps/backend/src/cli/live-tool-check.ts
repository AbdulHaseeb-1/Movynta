import { OpenAIProvider, type ModelProvider } from "@openai/agents";
import OpenAI from "openai";
import { z } from "zod";
import { ALL_TOOL_NAMES, TOOL_NAMES } from "../modules/tools/catalog/index.js";
import { EditorSimulator, openEventStream, startTestServer, type StreamedEvent } from "../testing/index.js";

/**
 * Opt-in check of the tool catalog against a real model through an
 * OpenAI-compatible gateway (Respan by default). It boots the real backend,
 * connects a simulated editor, asks the model to build a small character, and
 * reports which tools it called and whether the scene changed. Automated tests
 * never run this; they use a scripted model.
 *
 * Usage (from apps/backend, after `pnpm build`):
 *   RESPAN_API_KEY=... LIVE_MODELS=claude-haiku-5-5,deepseek-chat pnpm live:tools
 */
const DEFAULT_BASE_URL = "https://api.respan.ai/api";
const DEFAULT_MODELS = "claude-haiku-5-5,deepseek-chat";
const PROMPT =
  "Create a simple 3D character: a box torso (size 2) and a sphere head (size 1) on top of it at y 1.8. Plan first, then propose and apply the changes, then validate the scene.";
const RUN_TIMEOUT_MS = 180_000;
const acceptedRunSchema = z.object({ eventsUrl: z.string() });

/** Tools a correct run must use. The context or summary tool may be either. */
const REQUIRED_TOOLS = [
  TOOL_NAMES.modelingGeneratePlan,
  TOOL_NAMES.editorProposeCommands,
  TOOL_NAMES.editorApplyProposal,
  TOOL_NAMES.validationCheckScene,
] as const;

interface ModelReport {
  readonly model: string;
  readonly ok: boolean;
  readonly problems: readonly string[];
  readonly toolCalls: readonly string[];
  readonly failedCalls: readonly string[];
  readonly objectCount: number;
  readonly finalMessage: string;
}

/** Same transport as the app's "OpenAI-compatible" provider: Chat Completions, no redirects. */
function gatewayModelProvider(model: string, apiKey: string, baseURL: string): ModelProvider {
  const client = new OpenAI({ apiKey, baseURL, fetch: (input, init) => fetch(input, { ...init, redirect: "error" }) });
  const provider = new OpenAIProvider({ openAIClient: client, useResponses: false });
  // The test server asks for its placeholder model name; the live check always uses the requested one.
  return { getModel: () => provider.getModel(model) };
}

function failureOf(event: StreamedEvent): string {
  const payload: unknown = event.envelope.payload;
  const message = typeof payload === "object" && payload !== null && "message" in payload ? String(payload.message) : "";
  return `${toolNameOf(event)} (${message})`;
}

function toolNameOf(event: StreamedEvent): string {
  const payload: unknown = event.envelope.payload;
  return typeof payload === "object" && payload !== null && "toolName" in payload ? String(payload.toolName) : "";
}

async function checkModel(model: string, apiKey: string, baseURL: string): Promise<ModelReport> {
  const server = await startTestServer(0, gatewayModelProvider(model, apiKey, baseURL));
  try {
    const token = server.token("live-check");
    const editor = await EditorSimulator.connect(server.wsUrl, token, "live-project");
    const response = await fetch(`${server.baseUrl}/api/v1/agent-runs`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: "live-project", editorClientId: editor.clientId, message: PROMPT, dimension: "3d" }),
    });
    const run = acceptedRunSchema.parse(await response.json());
    const stream = openEventStream(server.baseUrl + run.eventsUrl, token);
    const terminal = await stream.waitFor(
      (event) => ["run.completed", "run.failed", "run.cancelled"].includes(event.envelope.type ?? ""),
      RUN_TIMEOUT_MS,
    );
    stream.stop();

    const toolCalls = stream.events.filter((e) => e.envelope.type === "tool.started").map(toolNameOf);
    const failedCalls = stream.events.filter((e) => e.envelope.type === "tool.failed").map(failureOf);
    const finalEvent = stream.events.find((e) => e.envelope.type === "agent.message.completed");
    const payload: unknown = finalEvent?.envelope.payload;
    const finalMessage = typeof payload === "object" && payload !== null && "text" in payload ? String(payload.text) : "";

    const problems: string[] = [];
    if (terminal.envelope.type !== "run.completed") problems.push(`run ended with ${terminal.envelope.type}`);
    for (const tool of REQUIRED_TOOLS) if (!toolCalls.includes(tool)) problems.push(`never called ${tool}`);
    if (!toolCalls.includes(TOOL_NAMES.editorGetContext) && !toolCalls.includes(TOOL_NAMES.editorGetSceneSummary)) {
      problems.push("never read the scene");
    }
    const unknown = toolCalls.filter((name) => !ALL_TOOL_NAMES.some((known) => known === name));
    if (unknown.length > 0) problems.push(`called unknown tools: ${unknown.join(", ")}`);
    if (editor.scene.objects.length < 2) problems.push(`scene has ${editor.scene.objects.length} objects, expected at least 2`);

    const report: ModelReport = {
      model,
      ok: problems.length === 0,
      problems,
      toolCalls,
      failedCalls,
      objectCount: editor.scene.objects.length,
      finalMessage: finalMessage.slice(0, 300),
    };
    editor.close();
    return report;
  } finally {
    await server.close();
  }
}

async function main(): Promise<void> {
  process.env["AGENT_RUN_TIMEOUT_MS"] = String(RUN_TIMEOUT_MS - 10_000);
  process.env["EDITOR_REQUEST_TIMEOUT_MS"] = "15000";
  const apiKey = process.env["RESPAN_API_KEY"];
  if (apiKey === undefined || apiKey.length === 0) {
    process.stderr.write("Set RESPAN_API_KEY (and optionally RESPAN_BASE_URL, LIVE_MODELS).\n");
    process.exit(2);
  }
  const baseURL = process.env["RESPAN_BASE_URL"] ?? DEFAULT_BASE_URL;
  const models = (process.env["LIVE_MODELS"] ?? DEFAULT_MODELS).split(",").map((m) => m.trim()).filter(Boolean);

  let failed = false;
  for (const model of models) {
    process.stdout.write(`\n== ${model}\n`);
    try {
      const report = await checkModel(model, apiKey, baseURL);
      failed ||= !report.ok;
      process.stdout.write(`${report.ok ? "PASS" : "FAIL"}\n`);
      process.stdout.write(`tool calls : ${report.toolCalls.join(" -> ")}\n`);
      process.stdout.write(`failed     : ${report.failedCalls.length === 0 ? "none" : report.failedCalls.join(", ")}\n`);
      process.stdout.write(`scene      : ${report.objectCount} objects\n`);
      if (report.problems.length > 0) process.stdout.write(`problems   : ${report.problems.join("; ")}\n`);
      process.stdout.write(`reply      : ${report.finalMessage}\n`);
    } catch (error) {
      failed = true;
      process.stdout.write(`FAIL: ${error instanceof Error ? error.message : "unknown error"}\n`);
    }
  }
  process.exit(failed ? 1 : 0);
}

void main();
