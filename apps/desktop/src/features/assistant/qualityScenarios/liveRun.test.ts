import { describe, expect, it } from "vitest";
import { z } from "zod";
import { bridgeMessageSchema, runScenarioLive, scenarioById, type BridgeMessage, type BridgeSocket, type LiveRunOptions } from "./index";

type Listener = (event: { readonly data?: unknown }) => void;

/** The backend as the headless editor sees it: a socket it authenticates on, requests it answers, and a run it finishes. */
class FakeBackend {
  readonly received: BridgeMessage[] = [];
  readonly requests: { method: string; path: string; body: string; authorization: string | null }[] = [];
  closed = false;
  runStatus = "running";
  usage = { requests: 5, inputTokens: 1200, outputTokens: 300, totalTokens: 1500 };
  error: string | undefined;
  /** What the pretend assistant does once the run starts. */
  script: (backend: FakeBackend) => Promise<void> = async () => undefined;
  private readonly listeners = new Map<string, Listener[]>();
  private readonly waiting: { event: string; resolve: (message: BridgeMessage) => void }[] = [];
  refuse: number | undefined;

  readonly socket: BridgeSocket = {
    send: (data) => {
      const message = bridgeMessageSchema.parse(JSON.parse(data));
      if (message.event === "auth") {
        expect(message.data["token"]).toBe("token-1");
        queueMicrotask(() => this.emit("message", { data: JSON.stringify({ event: "auth.ok", data: { clientId: "client_1" } }) }));
        return;
      }
      this.received.push(message);
      const index = this.waiting.findIndex((entry) => entry.event === message.event);
      if (index >= 0) this.waiting.splice(index, 1)[0]?.resolve(message);
    },
    close: () => { this.closed = true; },
    addEventListener: (type, listener) => { this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]); },
  };

  private emit(type: string, event: { readonly data?: unknown }): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  /** The connection becoming ready, as a real socket reports once it has connected. */
  open(): void {
    this.emit("open", {});
  }

  /** Delivers a message to the editor without waiting for an answer. */
  socketEmitRaw(message: BridgeMessage): void {
    this.emit("message", { data: JSON.stringify(message) });
  }

  /** Sends the editor a request and waits for the reply of the given kind. */
  async ask(event: string, data: Record<string, unknown>, reply: string): Promise<BridgeMessage> {
    const answer = new Promise<BridgeMessage>((resolve) => { this.waiting.push({ event: reply, resolve }); });
    this.emit("message", { data: JSON.stringify({ event, data }) });
    return answer;
  }

  readonly fetchImpl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const path = url.replace("http://backend", "");
    const method = init?.method ?? "GET";
    this.requests.push({ method, path, body: typeof init?.body === "string" ? init.body : "", authorization: new Headers(init?.headers).get("Authorization") });
    if (method === "POST" && path === "/api/v1/agent-runs") {
      if (this.refuse) return new Response("no", { status: this.refuse });
      void this.script(this).then(() => { if (this.runStatus === "running") this.runStatus = "completed"; });
      return new Response(JSON.stringify({ runId: "run_1" }), { status: 202 });
    }
    if (method === "POST" && path.endsWith("/cancel")) { this.runStatus = "cancelled"; return new Response("{}", { status: 200 }); }
    return new Response(JSON.stringify({ id: "run_1", status: this.runStatus, finalOutput: "Done.", usage: this.usage, ...(this.error ? { error: { message: this.error } } : {}) }), { status: 200 });
  };
}

function options(backend: FakeBackend, extra: Partial<LiveRunOptions> = {}): LiveRunOptions {
  return { baseUrl: "http://backend", token: "token-1", timeoutMs: 5000, pollMs: 2, fetchImpl: backend.fetchImpl, openSocket: () => { queueMicrotask(() => backend.open()); return backend.socket; }, ...extra };
}

/** An assistant that builds exactly the scenario's known answer (or a defective one), the way the backend would ask the editor to. */
function builds(scenarioId: string, defect?: string, phased = false): (backend: FakeBackend) => Promise<void> {
  return async (backend) => {
    const scenario = scenarioById(scenarioId);
    const context = await backend.ask("context.request", { requestId: "ctx" }, "context.response");
    const revision = z.object({ revision: z.number() }).parse(context.data["context"]).revision;
    const commands = scenario.solution(defect);
    if (commands.length === 0) return;
    if (phased) {
      const prepared = await backend.ask("commands.execute", { requestId: "prep", proposalId: "prp_1", expectedRevision: revision, commands, phase: "prepare" }, "commands.result");
      expect(prepared.data["status"]).toBe("applied");
      const committed = await backend.ask("commands.execute", { requestId: "commit", proposalId: "prp_1", expectedRevision: revision, commands, phase: "commit" }, "commands.result");
      expect(committed.data["status"]).toBe("applied");
      return;
    }
    const result = await backend.ask("commands.execute", { requestId: "run", proposalId: "prp_1", expectedRevision: revision, commands }, "commands.result");
    expect(result.data["status"]).toBe("applied");
  };
}

const failed = (labels: readonly { label: string; status: string }[]) => labels.filter((entry) => entry.status !== "pass").map((entry) => entry.label).sort();

describe("running a scenario against the backend", () => {
  it("drives the run through the bridge and scores what the assistant built on the real editor", async () => {
    const backend = new FakeBackend();
    backend.script = builds("chair");
    const result = await runScenarioLive(scenarioById("chair"), 1, options(backend, { providerId: "openai", model: "m-1", reasoningEffort: "high" }));
    expect(result).toMatchObject({ scenarioId: "chair", trial: 1, runId: "run_1", status: "completed", finalOutput: "Done.", usage: backend.usage });
    expect(result.score.ratio).toBe(1);
    expect(result.bridgeFaults).toBeUndefined();
    expect(backend.closed).toBe(true);
    // The project made for the run is removed afterwards.
    expect(backend.requests.some((request) => request.method === "DELETE" && request.path.startsWith("/api/v1/projects/quality-chair-1-"))).toBe(true);

    const start = backend.requests.find((request) => request.method === "POST" && request.path === "/api/v1/agent-runs");
    expect(start?.authorization).toBe("Bearer token-1");
    expect(JSON.parse(start?.body ?? "{}")).toMatchObject({
      message: scenarioById("chair").prompt, dimension: "3d", editorClientId: "client_1", providerId: "openai", model: "m-1", reasoningEffort: "high",
    });
    expect(z.object({ projectId: z.string() }).parse(JSON.parse(start?.body ?? "{}")).projectId).toMatch(/^quality-chair-1-[a-z0-9]+$/);
  });

  it("scores a defective build by the checks it breaks", async () => {
    const backend = new FakeBackend();
    backend.script = builds("chair", "floating-back");
    const result = await runScenarioLive(scenarioById("chair"), 2, options(backend));
    expect(failed(result.score.results)).toEqual(["No loose parts"]);
    expect(result.score.passed).toBe(result.score.total - 1);
  });

  it("scores the same when the editor prepares a change and commits it afterwards, as current backends do", async () => {
    const backend = new FakeBackend();
    backend.script = builds("table", undefined, true);
    const result = await runScenarioLive(scenarioById("table"), 1, options(backend));
    expect(result.score.ratio).toBe(1);
  });

  it("measures edits to an existing mesh, including that the solid is still closed", async () => {
    const good = new FakeBackend();
    good.script = builds("halve-block");
    expect((await runScenarioLive(scenarioById("halve-block"), 1, options(good))).score.ratio).toBe(1);
    const open = new FakeBackend();
    open.script = builds("halve-block", "open");
    expect(failed((await runScenarioLive(scenarioById("halve-block"), 1, options(open))).score.results)).toEqual(["block is still a closed solid"]);
  });

  it("cancels a run that outlasts its time and scores what it left", async () => {
    const backend = new FakeBackend();
    backend.script = async () => new Promise<void>(() => undefined);
    const result = await runScenarioLive(scenarioById("chair"), 1, options(backend, { timeoutMs: 40 }));
    expect(result.status).toBe("timeout");
    expect(backend.requests.some((request) => request.path.endsWith("/cancel"))).toBe(true);
    expect(result.score.ratio).toBe(0);
  });

  it("keeps the work of a run that failed and reports why", async () => {
    const backend = new FakeBackend();
    backend.script = async (self) => { await builds("mug")(self); self.runStatus = "failed"; self.error = "The provider stopped answering"; };
    const result = await runScenarioLive(scenarioById("mug"), 1, options(backend));
    expect(result).toMatchObject({ status: "failed", error: "The provider stopped answering" });
    expect(result.score.ratio).toBe(1);
  });

  it("answers a request to look at the scene with an error and reports a request it cannot read", async () => {
    const backend = new FakeBackend();
    backend.script = async (self) => {
      const view = await self.ask("view.request", { requestId: "view-1" }, "view.error");
      expect(view.data["requestId"]).toBe("view-1");
      expect(String(view.data["message"])).toContain("No viewport");
      self.socketEmitRaw({ event: "commands.execute", data: { proposalId: "prp_x" } });
    };
    const result = await runScenarioLive(scenarioById("sword"), 1, options(backend));
    expect(result.bridgeFaults).toHaveLength(1);
    expect(result.bridgeFaults?.[0]).toContain("commands.execute");
  });

  it("keeps the project when asked to", async () => {
    const backend = new FakeBackend();
    backend.script = builds("mug");
    await runScenarioLive(scenarioById("mug"), 1, options(backend, { keepProjects: true }));
    expect(backend.requests.some((request) => request.method === "DELETE")).toBe(false);
  });

  it("stops with a clear error when the backend will not start the run, and closes the connection", async () => {
    const backend = new FakeBackend();
    backend.refuse = 403;
    await expect(runScenarioLive(scenarioById("chair"), 1, options(backend))).rejects.toThrow("403");
    expect(backend.closed).toBe(true);
  });
});
