import type { AgentInputItem } from "@openai/agents";
import { assistantMessage, functionCall, modelResponder } from "@openai/agents/testing";
import { startTestServer, type TestServer } from "../testing/test-app.js";
import { openEventStream, type EventStream, type StreamedEvent } from "../testing/event-stream.js";
import { EditorSimulator } from "../testing/editor-simulator.js";

interface HttpResult<T = unknown> {
  readonly status: number;
  readonly body: T;
  readonly headers: Headers;
}

interface AcceptedRun {
  readonly runId: string;
  readonly sessionId: string;
  readonly status: string;
  readonly eventsUrl: string;
}

interface ApprovalRow {
  readonly id: string;
  readonly status: string;
  readonly toolName: string;
  readonly preview: { readonly proposalId?: string; readonly commandCount?: number };
}

interface RunRow {
  readonly id: string;
  readonly status: string;
  readonly finalOutput?: string;
  readonly error?: { readonly code: string; readonly message: string };
}

let server: TestServer;

const TERMINAL_TYPES: readonly string[] = ["run.completed", "run.failed", "run.cancelled"];

async function http<T = unknown>(
  method: string,
  path: string,
  options: { readonly token?: string; readonly body?: unknown } = {},
): Promise<HttpResult<T>> {
  const headers: Record<string, string> = {};
  if (options.token) headers["Authorization"] = `Bearer ${options.token}`;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(server.baseUrl + path, {
    method,
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const text = await response.text();
  return { status: response.status, body: (text.length > 0 ? JSON.parse(text) : undefined) as T, headers: response.headers };
}

const PROPOSAL_ID = /prp_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

/** Returns the most recent proposal id in the conversation, so scripted steps can reference it. */
function latestProposalId(input: string | AgentInputItem[]): string {
  const serialized = typeof input === "string" ? input : JSON.stringify(input);
  const matches = [...serialized.matchAll(PROPOSAL_ID)];
  const latest = matches[matches.length - 1]?.[0];
  if (latest === undefined) throw new Error("No proposal id found in the conversation history");
  return latest;
}

async function createRun(token: string, body: Record<string, unknown>): Promise<AcceptedRun> {
  const response = await http<AcceptedRun>("POST", "/api/v1/agent-runs", { token, body });
  expect(response.status).toBe(202);
  return response.body;
}

function streamFor(run: AcceptedRun, token: string, lastEventId?: string): EventStream {
  return openEventStream(server.baseUrl + run.eventsUrl, token, lastEventId);
}

const torsoScene = [
  {
    id: "torso",
    name: "Torso",
    type: "mesh" as const,
    parentId: null,
    transform: { position: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0] as [number, number, number], scale: [1, 1, 1] as [number, number, number] },
  },
];

beforeAll(async () => {
  server = await startTestServer();
}, 60_000);

afterAll(async () => {
  await server.close();
});

describe("platform endpoints", () => {
  it("reports liveness and readiness without a token", async () => {
    expect((await http("GET", "/health/live")).status).toBe(200);
    const ready = await http<{ status: string }>("GET", "/health/ready");
    expect(ready.status).toBe(200);
    expect(ready.body.status).toBe("ready");
  });

  it("serves the OpenAPI document", async () => {
    const response = await http<{ openapi: string; paths: Record<string, unknown> }>("GET", "/api/docs-json");
    expect(response.status).toBe(200);
    expect(response.body.openapi).toMatch(/^3\./);
    expect(Object.keys(response.body.paths)).toContain("/api/v1/agent-runs");
  });

  it("rejects protected routes without a bearer token using the structured error body", async () => {
    const response = await http<{ error: { code: string; requestId: string } }>("GET", "/api/v1/agents");
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("unauthorized");
    expect(response.body.error.requestId.length).toBeGreaterThan(0);
    expect(response.headers.get("x-request-id")).toBe(response.body.error.requestId);
  });

  it("lists the modeling coordinator agent to an authenticated user", async () => {
    const response = await http<{ id: string }[]>("GET", "/api/v1/agents", { token: server.token("alice") });
    expect(response.status).toBe(200);
    expect(response.body.map((agent) => agent.id)).toContain("modeling-coordinator");
  });

  it("returns 404 for unknown agents and 400 for malformed run ids", async () => {
    const token = server.token("alice");
    expect((await http("GET", "/api/v1/agents/unknown-agent", { token })).status).toBe(404);
    expect((await http("GET", "/api/v1/agent-runs/not-a-run", { token })).status).toBe(400);
  });

  it("validates request bodies and rejects unknown fields", async () => {
    const response = await http<{ error: { code: string } }>("POST", "/api/v1/agent-runs", {
      token: server.token("alice"),
      body: { projectId: "proj-validation", message: "", surprise: true },
    });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("bad_request");
  });

  it("serves skills to authenticated users", async () => {
    const response = await http<{ id: string }[]>("GET", "/api/v1/skills", { token: server.token("alice") });
    expect(response.body.map((skill) => skill.id)).toEqual(
      expect.arrayContaining(["character-modeling", "mesh-editing", "character-rigging", "2.5d-character-design"]),
    );
  });
});

describe("agent run: propose, approve-free apply, and streaming", () => {
  it("runs the modeling workflow end to end and streams progress", async () => {
    const token = server.token("alice");
    const editor = await EditorSimulator.connect(server.wsUrl, token, "proj-happy");

    server.model.enqueue(
      [functionCall("skills__load_skill", { skillId: "character-modeling" }, { callId: "skill-1" })],
      [functionCall("editor__get_context", {}, { callId: "ctx-1" })],
      [
        functionCall(
          "modeling__generate_model_plan",
          {
            goal: "Blocky humanoid torso",
            dimension: "3d",
            steps: [
              {
                id: "torso",
                title: "Torso block",
                toolName: "editor.propose_commands",
                description: "One box for the torso",
                requiresApproval: false,
              },
            ],
          },
          { callId: "plan-1" },
        ),
      ],
      [
        functionCall(
          "editor__propose_commands",
          {
            summary: "Add a torso box",
            commands: [{ commandId: "c-torso", type: "geometry.create_primitive", objectId: "torso", primitive: "box", size: 1, replaceExisting: false }],
          },
          { callId: "propose-1" },
        ),
      ],
      modelResponder((call) => [
        functionCall("editor__apply_proposal", { proposalId: latestProposalId(call.request.input) }, { callId: "apply-1" }),
      ]),
      [assistantMessage("The torso is in the scene.")],
    );

    const run = await createRun(token, {
      projectId: "proj-happy",
      editorClientId: editor.clientId,
      message: "Create a 3D humanoid character with a torso",
      dimension: "3d",
    });
    expect(run.status).toBe("running");

    const stream = streamFor(run, token);
    const terminal = await stream.waitFor((event) => TERMINAL_TYPES.includes(event.envelope.type), 20_000);
    stream.stop();
    // Asserting on the terminal event shows the failure payload when the run does not complete.
    expect(terminal.envelope).toMatchObject({ type: "run.completed" });

    const types = stream.events.map((event: StreamedEvent) => event.envelope.type);
    expect(types).toEqual(
      expect.arrayContaining([
        "run.started",
        "skill.loaded",
        "tool.started",
        "tool.completed",
        "editor.proposal.created",
        "agent.message.completed",
        "run.completed",
      ]),
    );
    expect(types.indexOf("run.started")).toBe(0);
    expect(new Set(stream.events.map((event) => event.id)).size).toBe(stream.events.length);

    expect(editor.executions).toHaveLength(1);
    expect(editor.executions[0]?.commands[0]?.type).toBe("geometry.create_primitive");

    const finished = await http<RunRow>("GET", run.eventsUrl.replace("/events", ""), { token });
    expect(finished.body.status).toBe("completed");
    expect(finished.body.finalOutput).toBe("The torso is in the scene.");
    editor.close();
  }, 30_000);

  it("resumes from Last-Event-ID without duplicating or skipping events", async () => {
    const token = server.token("alice");
    const editor = await EditorSimulator.connect(server.wsUrl, token, "proj-resume");
    server.model.enqueue([assistantMessage("Hello from the agent.")]);
    const run = await createRun(token, { projectId: "proj-resume", editorClientId: editor.clientId, message: "Say hello" });

    const first = streamFor(run, token);
    await first.waitFor((event) => event.envelope.type === "run.completed", 20_000);
    first.stop();
    const midpoint = first.events[1];
    expect(midpoint?.id).toBeDefined();

    const resumed = streamFor(run, token, midpoint?.id);
    await resumed.waitFor((event) => event.envelope.type === "run.completed", 10_000);
    resumed.stop();

    const seqs = resumed.events.map((event) => Number(event.id));
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(Math.min(...seqs)).toBeGreaterThan(Number(midpoint?.id));
    editor.close();
  }, 30_000);

  it("blocks requests that ask the agent to run code before the model is called", async () => {
    const token = server.token("alice");
    const run = await createRun(token, { projectId: "proj-policy", message: "Run this python script for me" });
    const stream = streamFor(run, token);
    await stream.waitFor((event) => event.envelope.type === "run.failed", 15_000);
    stream.stop();

    const view = await http<RunRow>("GET", `/api/v1/agent-runs/${run.runId}`, { token });
    expect(view.body.status).toBe("failed");
    expect(view.body.error?.code).toBe("guardrail_blocked");
  }, 30_000);
});

describe("agent run: approvals", () => {
  async function startDeleteRun(token: string, projectId: string, editor: EditorSimulator) {
    server.model.enqueue(
      [functionCall("editor__get_context", {}, { callId: "ctx-d" })],
      [
        functionCall(
          "editor__propose_commands",
          { summary: "Remove the torso", commands: [{ commandId: "d-torso", type: "scene.delete_object", objectId: "torso" }] },
          { callId: "propose-d" },
        ),
      ],
      modelResponder((call) => [
        functionCall("editor__apply_proposal", { proposalId: latestProposalId(call.request.input) }, { callId: "apply-d" }),
      ]),
    );
    const run = await createRun(token, { projectId, editorClientId: editor.clientId, message: "Delete the torso" });
    const stream = streamFor(run, token);
    const required = await stream.waitFor((event) => event.envelope.type === "approval.required", 20_000);
    stream.stop();
    return { run, required };
  }

  it("pauses for approval, then executes the change once the user approves", async () => {
    const token = server.token("bob");
    const editor = await EditorSimulator.connect(server.wsUrl, token, "proj-approve", torsoScene);
    const { run, required } = await startDeleteRun(token, "proj-approve", editor);
    server.model.enqueue([assistantMessage("Removed the torso.")]);

    const approvals = await http<ApprovalRow[]>("GET", `/api/v1/agent-runs/${run.runId}/approvals`, { token });
    expect(approvals.body).toHaveLength(1);
    const approval = approvals.body[0];
    expect(approval?.status).toBe("pending");
    expect(approval?.toolName).toBe("editor.apply_proposal");
    expect(editor.executions).toHaveLength(0);

    const decided = await http<{ runStatus: string }>(
      "POST",
      `/api/v1/agent-runs/${run.runId}/approvals/${approval?.id}`,
      { token, body: { decision: "approve" } },
    );
    expect(decided.status).toBe(200);
    expect(decided.body.runStatus).toBe("running");

    const resumed = streamFor(run, token, required.id);
    await resumed.waitFor((event) => event.envelope.type === "run.completed", 20_000);
    resumed.stop();

    expect(editor.executions).toHaveLength(1);
    expect(editor.executions[0]?.commands[0]?.type).toBe("scene.delete_object");
    const final = await http<RunRow>("GET", `/api/v1/agent-runs/${run.runId}`, { token });
    expect(final.body.status).toBe("completed");
    editor.close();
  }, 40_000);

  it("does not execute anything when the user rejects, and tells the agent", async () => {
    const token = server.token("carol");
    const editor = await EditorSimulator.connect(server.wsUrl, token, "proj-reject", torsoScene);
    const { run } = await startDeleteRun(token, "proj-reject", editor);
    server.model.enqueue([assistantMessage("I kept the torso as requested.")]);

    const approvals = await http<ApprovalRow[]>("GET", `/api/v1/agent-runs/${run.runId}/approvals`, { token });
    const approvalId = approvals.body[0]?.id ?? "";
    await http("POST", `/api/v1/agent-runs/${run.runId}/approvals/${approvalId}`, {
      token,
      body: { decision: "reject", reason: "Keep it" },
    });

    const stream = streamFor(run, token);
    await stream.waitFor((event) => event.envelope.type === "run.completed", 20_000);
    stream.stop();

    expect(editor.executions).toHaveLength(0);
    const final = await http<RunRow>("GET", `/api/v1/agent-runs/${run.runId}`, { token });
    expect(final.body.finalOutput).toBe("I kept the torso as requested.");
    editor.close();
  }, 40_000);

  it("refuses a second decision on the same approval", async () => {
    const token = server.token("dave");
    const editor = await EditorSimulator.connect(server.wsUrl, token, "proj-double", torsoScene);
    const { run } = await startDeleteRun(token, "proj-double", editor);
    const approvals = await http<ApprovalRow[]>("GET", `/api/v1/agent-runs/${run.runId}/approvals`, { token });
    const approvalId = approvals.body[0]?.id ?? "";
    server.model.enqueue([assistantMessage("Done.")]);

    const first = await http("POST", `/api/v1/agent-runs/${run.runId}/approvals/${approvalId}`, { token, body: { decision: "approve" } });
    expect(first.status).toBe(200);
    const second = await http<{ error: { code: string } }>("POST", `/api/v1/agent-runs/${run.runId}/approvals/${approvalId}`, {
      token,
      body: { decision: "approve" },
    });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("conflict");
    editor.close();
  }, 40_000);

  it("cancels a run that is waiting for approval and expires its approvals", async () => {
    const token = server.token("erin");
    const editor = await EditorSimulator.connect(server.wsUrl, token, "proj-cancel", torsoScene);
    const { run } = await startDeleteRun(token, "proj-cancel", editor);

    const cancelled = await http<{ status: string }>("POST", `/api/v1/agent-runs/${run.runId}/cancel`, { token });
    expect(cancelled.status).toBe(202);
    expect(cancelled.body.status).toBe("cancelled");

    const approvals = await http<ApprovalRow[]>("GET", `/api/v1/agent-runs/${run.runId}/approvals`, { token });
    expect(approvals.body[0]?.status).toBe("expired");
    expect(editor.executions).toHaveLength(0);
    editor.close();
  }, 40_000);
});

describe("tenant isolation", () => {
  it("does not let another user start a run in a project they do not own", async () => {
    const owner = server.token("frank");
    const editor = await EditorSimulator.connect(server.wsUrl, owner, "proj-frank");
    server.model.enqueue([assistantMessage("Hi frank.")]);
    await createRun(owner, { projectId: "proj-frank", editorClientId: editor.clientId, message: "Hello" });

    const intruder = await http<{ error: { code: string } }>("POST", "/api/v1/agent-runs", {
      token: server.token("mallory"),
      body: { projectId: "proj-frank", message: "Hello" },
    });
    expect(intruder.status).toBe(403);
    expect(intruder.body.error.code).toBe("forbidden");
    editor.close();
  });

  it("hides another user's runs, approvals, and events behind 404", async () => {
    const owner = server.token("gina");
    server.model.enqueue([assistantMessage("Private.")]);
    const run = await createRun(owner, { projectId: "proj-gina", message: "Private note" });
    const intruder = server.token("harry");

    expect((await http("GET", `/api/v1/agent-runs/${run.runId}`, { token: intruder })).status).toBe(404);
    expect((await http("GET", `/api/v1/agent-runs/${run.runId}/approvals`, { token: intruder })).status).toBe(404);
    expect((await http("POST", `/api/v1/agent-runs/${run.runId}/cancel`, { token: intruder })).status).toBe(404);
    expect((await http("GET", run.eventsUrl, { token: intruder })).status).toBe(404);
  });

  it("does not expose another user's session", async () => {
    const owner = server.token("ivy");
    const session = await http<{ id: string }>("POST", "/api/v1/sessions", { token: owner, body: { projectId: "proj-ivy" } });
    expect(session.status).toBe(201);

    const intruder = await http("GET", `/api/v1/sessions/${session.body.id}`, { token: server.token("jack") });
    expect(intruder.status).toBe(404);
  });
});

describe("editor bridge security", () => {
  it("rejects editor sockets that present an invalid token", async () => {
    const socket = new WebSocket(server.wsUrl);
    await new Promise<void>((resolve) => socket.addEventListener("open", () => resolve(), { once: true }));
    const closed = new Promise<CloseEvent>((resolve) => socket.addEventListener("close", resolve, { once: true }));
    socket.send(JSON.stringify({ event: "auth", data: { token: "mv1.bad.token", projectId: "proj-x" } }));
    const event = await closed;
    expect(event.code).toBe(4401);
  });

  it("rejects editor messages that do not match the protocol schema", async () => {
    const editor = await EditorSimulator.connect(server.wsUrl, server.token("kim"), "proj-kim");
    editor.sendRaw("context.response", { requestId: "x", context: { nope: true } });
    const error = await editor.waitForEvent("error");
    expect(error.data["code"]).toBe("invalid_message");
    editor.close();
  });
});
