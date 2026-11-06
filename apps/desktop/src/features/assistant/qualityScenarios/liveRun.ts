import { z } from "zod";
import { observeOutcome, snapshotOf, startScenario } from "./runScenario";
import { bridgeMessageSchema, HeadlessEditor, type BridgeMessage } from "./headlessEditor";
import { scoreScenario } from "./scoring";
import type { QualityScenario, ScenarioScore } from "./types";

/** The part of a WebSocket the runner uses, so a test can stand in for the backend. */
export interface BridgeSocket {
  send(data: string): void;
  close(): void;
  addEventListener(type: "open" | "message" | "close" | "error", listener: (event: { readonly data?: unknown }) => void): void;
}

export interface LiveRunOptions {
  /** The backend's address, such as http://127.0.0.1:3001. */
  readonly baseUrl: string;
  /** A bearer token the backend accepts. */
  readonly token: string;
  readonly providerId?: string;
  readonly model?: string;
  readonly reasoningEffort?: string;
  /** Longest a run may take before it is cancelled and scored as it stands. */
  readonly timeoutMs: number;
  readonly pollMs?: number;
  /** Keep the project each run creates. By default it is deleted once the run is scored. */
  readonly keepProjects?: boolean;
  readonly fetchImpl?: typeof fetch;
  readonly openSocket?: (url: string) => BridgeSocket;
}

export type LiveRunStatus = "completed" | "failed" | "cancelled" | "timeout";

export interface LiveRunResult {
  readonly scenarioId: string;
  readonly trial: number;
  readonly runId: string;
  readonly status: LiveRunStatus;
  readonly durationMs: number;
  readonly score: ScenarioScore;
  readonly usage?: { readonly requests: number; readonly inputTokens: number; readonly outputTokens: number; readonly totalTokens: number };
  readonly finalOutput?: string;
  readonly error?: string;
  /** Requests from the backend that the headless editor could not answer. */
  readonly bridgeFaults?: readonly string[];
}

const acceptedSchema = z.object({ runId: z.string() });
const runViewSchema = z.object({
  status: z.string().optional(),
  finalOutput: z.string().optional(),
  error: z.object({ message: z.string().optional() }).optional(),
  usage: z.object({ requests: z.number(), inputTokens: z.number(), outputTokens: z.number(), totalTokens: z.number() }).optional(),
});
type RunView = z.infer<typeof runViewSchema>;

const sleep = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); });

/** Opens the editor side of the bridge as a headless editor and resolves with the client id the backend gave it. */
async function connect(headless: HeadlessEditor, options: LiveRunOptions, projectId: string): Promise<{ clientId: string; socket: BridgeSocket }> {
  const url = `${options.baseUrl.replace(/^http/, "ws")}/api/v1/editor/ws`;
  const socket = options.openSocket ? options.openSocket(url) : new WebSocket(url);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.close(); reject(new Error("The backend did not accept the editor connection")); }, 10_000);
    socket.addEventListener("open", () => socket.send(JSON.stringify({ event: "auth", data: { token: options.token, projectId } })));
    socket.addEventListener("error", () => { clearTimeout(timer); reject(new Error("Could not connect to the editor bridge")); });
    socket.addEventListener("message", (event) => {
      if (typeof event.data !== "string") return;
      const parsed = bridgeMessageSchema.safeParse(JSON.parse(event.data));
      if (!parsed.success) return;
      const message: BridgeMessage = parsed.data;
      if (message.event === "auth.ok" && typeof message.data["clientId"] === "string") { clearTimeout(timer); resolve({ clientId: message.data["clientId"], socket }); return; }
      if (message.event === "error") { clearTimeout(timer); reject(new Error("The backend refused the editor's token")); return; }
      try {
        for (const reply of headless.respond(message)) socket.send(JSON.stringify(reply));
      } catch (error) {
        headless.faults.push(`${message.event}: ${error instanceof Error ? error.message.slice(0, 200) : "failed"}`);
      }
    });
  });
}

/**
 * Gives the assistant one scenario's request in a fresh project, lets it work against a headless editor, and scores
 * what it left behind with the scenario's own checks. Errors that stop the run from happening at all are thrown; a
 * run that fails or runs out of time is a result with a score, because what it did before then still counts.
 */
export async function runScenarioLive(scenario: QualityScenario, trial: number, options: LiveRunOptions): Promise<LiveRunResult> {
  const doFetch = options.fetchImpl ?? fetch;
  const headers = { Authorization: `Bearer ${options.token}`, "Content-Type": "application/json" };
  const editor = startScenario(scenario);
  const before = snapshotOf(editor);
  const projectId = `quality-${scenario.id}-${trial}-${Math.random().toString(36).slice(2, 8)}`;
  const headless = new HeadlessEditor(editor);
  const { clientId, socket } = await connect(headless, options, projectId);
  const started = Date.now();
  try {
    const created = await doFetch(`${options.baseUrl}/api/v1/agent-runs`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        projectId, message: scenario.prompt, dimension: "3d", editorClientId: clientId,
        ...(options.providerId ? { providerId: options.providerId } : {}),
        ...(options.model ? { model: options.model } : {}),
        ...(options.reasoningEffort ? { reasoningEffort: options.reasoningEffort } : {}),
      }),
    });
    if (created.status !== 202) throw new Error(`The backend did not start the run (${created.status}): ${(await created.text()).slice(0, 300)}`);
    const { runId } = acceptedSchema.parse(await created.json());

    let view: RunView = {};
    let status: LiveRunStatus = "timeout";
    while (Date.now() - started < options.timeoutMs) {
      // eslint-disable-next-line no-await-in-loop -- Polling waits for each answer before asking again.
      const response = await doFetch(`${options.baseUrl}/api/v1/agent-runs/${runId}`, { headers });
      // eslint-disable-next-line no-await-in-loop
      view = runViewSchema.parse(await response.json());
      if (view.status === "completed" || view.status === "failed" || view.status === "cancelled") { status = view.status; break; }
      // eslint-disable-next-line no-await-in-loop
      await sleep(options.pollMs ?? 1000);
    }
    if (status === "timeout") await doFetch(`${options.baseUrl}/api/v1/agent-runs/${runId}/cancel`, { method: "POST", headers });

    const score = scoreScenario(scenario, observeOutcome(editor, scenario, before));
    return {
      scenarioId: scenario.id, trial, runId, status, durationMs: Date.now() - started, score,
      ...(view.usage ? { usage: view.usage } : {}), ...(view.finalOutput ? { finalOutput: view.finalOutput } : {}),
      ...(view.error?.message ? { error: view.error.message } : {}),
      ...(headless.faults.length > 0 ? { bridgeFaults: headless.faults } : {}),
    };
  } finally {
    socket.close();
    if (!options.keepProjects) {
      // A project only exists to hold this one run. Failing to remove it must not hide the score.
      await doFetch(`${options.baseUrl}/api/v1/projects/${projectId}`, { method: "DELETE", headers }).catch(() => undefined);
    }
  }
}
