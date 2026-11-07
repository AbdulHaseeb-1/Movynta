import type { AgentInputItem } from "@openai/agents";
import { jest } from "@jest/globals";
import { ToolRegistry } from "../modules/tools/tool.registry.js";
import { EDITOR_BRIDGE } from "../modules/editor-bridge/editor-bridge.tokens.js";
import type { EditorBridge } from "../modules/editor-bridge/editor-bridge.types.js";
import { assistantMessage, functionCall, modelResponder } from "@openai/agents/testing";
import { startTestServer } from "../testing/test-app.js";
import { openEventStream } from "../testing/event-stream.js";
import { EditorSimulator, SIMULATED_IMAGE_BASE64 } from "../testing/editor-simulator.js";
import { AgentRegistry } from "../modules/agents/agent.registry.js";
import { ServiceUnavailableError } from "../common/errors/app-error.js";
import { DatabaseService } from "../modules/persistence/database.service.js";
import type { EventStream, StreamedEvent, TestServer } from "../testing/testing.types.js";

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
  readonly usage?: { readonly requests: number };
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
      expect.arrayContaining(["character-modeling", "mesh-editing"]),
    );
  });
});

describe("agent run: propose, approve-free apply, and streaming", () => {
  it("calculates procedural commands before proposing and applying them", async () => {
    const token = server.token("alice");
    const editor = await EditorSimulator.connect(server.wsUrl, token, "proj-procedural");
    const commands = Array.from({ length: 3 }, (_, i) => ({
      commandId: `step_${i}`, type: "scene.create_object", objectId: `step_${i}`, name: `Step ${i}`,
      transform: { position: [i * 2, 0, 0] },
    }));
    server.model.enqueue(
      [functionCall("modeling__generate_commands", {
        source: "return Array.from({length:3}, (_,i) => ({commandId:'step_'+i, type:'scene.create_object', objectId:'step_'+i, name:'Step '+i, transform:{position:[i*2,0,0]}}));",
      }, { callId: "generate-layout" })],
      modelResponder((call) => {
        expect(JSON.stringify(call.request.input)).toContain("generated");
        expect(editor.executions).toHaveLength(0);
        return [functionCall("editor__propose_commands", { summary: "Three steps", commands, expectedRevision: 0 }, { callId: "propose-layout" })];
      }),
      modelResponder((call) => [functionCall("editor__apply_proposal", { proposalId: latestProposalId(call.request.input) }, { callId: "apply-layout" })]),
      // The run asks for a scene check after a change before it accepts the final reply.
      [functionCall("validation__check_scene", {}, { callId: "check-layout" })],
      [assistantMessage("Three steps are arranged.")],
    );
    try {
      const run = await createRun(token, { projectId: "proj-procedural", editorClientId: editor.clientId, message: "Run JavaScript to arrange three steps" });
      const stream = streamFor(run, token);
      try {
        const terminal = await stream.waitFor((event) => TERMINAL_TYPES.includes(event.envelope.type), 20_000);
        expect(terminal.envelope.type).toBe("run.completed");
        expect(editor.executions).toHaveLength(1);
        expect(editor.scene.objects).toHaveLength(3);
      } finally {
        stream.stop();
      }
    } finally {
      editor.close();
    }
  }, 30_000);

  it("lets the model look at the scene from several views and hands it the pictures", async () => {
    const token = server.token("alice");
    const editor = await EditorSimulator.connect(server.wsUrl, token, "proj-look", torsoScene);
    server.model.enqueue(
      [
        functionCall(
          "viewport__capture",
          { views: [{ preset: "front", label: "Front" }, { preset: "top" }], focus: ["torso"], mode: "wireframe" },
          { callId: "look-1" },
        ),
      ],
      modelResponder((call) => {
        const input = JSON.stringify(call.request.input);
        // The pictures reach the model as image parts, next to the measurements that say what is in them.
        expect(input).toContain("input_image");
        expect(input).toContain(SIMULATED_IMAGE_BASE64);
        expect(input).toContain("screenBounds");
        return [assistantMessage("The torso looks right from the front and above.")];
      }),
    );
    try {
      const run = await createRun(token, { projectId: "proj-look", editorClientId: editor.clientId, message: "Look at the torso" });
      const stream = streamFor(run, token);
      try {
        const terminal = await stream.waitFor((event) => TERMINAL_TYPES.includes(event.envelope.type), 20_000);
        expect(terminal.envelope.type).toBe("run.completed");
        expect(editor.viewRequests).toHaveLength(1);
        expect(editor.viewRequests[0]?.withImages).toBe(true);
        expect(editor.viewRequests[0]?.request.views).toHaveLength(2);
        expect(editor.viewRequests[0]?.request.mode).toBe("wireframe");
        // The chat is told which views were drawn, under the id the editor was given, and never receives the pictures.
        const captured = stream.events.find((event) => event.envelope.type === "viewport.captured");
        expect(captured?.envelope.payload).toEqual({
          captureId: editor.viewRequests[0]?.captureId,
          views: [
            { label: "Front", width: 768, height: 576 },
            { label: "top", width: 768, height: 576 },
          ],
          imagesSent: true,
        });
        expect(JSON.stringify(stream.events)).not.toContain(SIMULATED_IMAGE_BASE64);
      } finally {
        stream.stop();
      }
    } finally {
      editor.close();
    }
  }, 30_000);

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
      [functionCall("validation__check_scene", {}, { callId: "check-1" })],
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

  it("proposes and applies in one call, and finishes once the change is checked", async () => {
    const token = server.token("alice");
    const editor = await EditorSimulator.connect(server.wsUrl, token, "proj-one-call");
    const toolOutputs: string[] = [];
    server.model.enqueue(
      [functionCall("editor__propose_commands", {
        summary: "Add a crate",
        apply: true,
        commands: [{ commandId: "crate", type: "geometry.create_primitive", objectId: "crate", primitive: "box", size: 1, replaceExisting: false }],
      }, { callId: "propose-apply" })],
      modelResponder((call) => {
        toolOutputs.push(JSON.stringify(call.request.input));
        return [functionCall("validation__check_scene", {}, { callId: "check-one-call" })];
      }),
      [assistantMessage("The crate is in the scene.")],
    );
    const run = await createRun(token, { projectId: "proj-one-call", editorClientId: editor.clientId, message: "Add a crate", dimension: "3d" });
    const stream = streamFor(run, token);
    const terminal = await stream.waitFor((event) => TERMINAL_TYPES.includes(event.envelope.type), 20_000);
    stream.stop();
    expect(terminal.envelope).toMatchObject({ type: "run.completed" });
    // One model call reached the editor, and the model was told the batch applied.
    expect(editor.executions).toHaveLength(1);
    expect(toolOutputs[0]).toContain('\\"status\\":\\"applied\\"');
    const types = stream.events.map((event: StreamedEvent) => event.envelope.type);
    expect(types).not.toContain("agent.continued");
    editor.close();
  }, 30_000);

  it("answers a malformed command with the field to fix, and the run goes on", async () => {
    const token = server.token("alice");
    const editor = await EditorSimulator.connect(server.wsUrl, token, "proj-bad-args");
    const toolOutputs: string[] = [];
    server.model.enqueue(
      [functionCall("editor__propose_commands", {
        summary: "Scale the crate",
        apply: true,
        commands: [{ commandId: "wide", type: "scene.transform_object", objectId: "crate", transform: { scale: [2, 1] } }],
      }, { callId: "bad-args" })],
      modelResponder((call) => {
        toolOutputs.push(JSON.stringify(call.request.input));
        return [assistantMessage("I need to fix the scale.")];
      }),
    );
    const run = await createRun(token, { projectId: "proj-bad-args", editorClientId: editor.clientId, message: "Make the crate wider", dimension: "3d" });
    const stream = streamFor(run, token);
    // Before, the SDK's own refusal reached the model as a bare "try again"; a copy check on approval input must not fail the run either.
    const end = await stream.waitFor((event) => TERMINAL_TYPES.includes(event.envelope.type), 20_000);
    stream.stop();
    expect(end.envelope.type).toBe("run.completed");
    expect(editor.executions).toHaveLength(0);
    expect(toolOutputs[0]).toContain("do not match this tool's schema");
    expect(toolOutputs[0]).toContain(".transform.scale");
    expect(toolOutputs[0]).toContain("expected array to have exactly 3 items");
    const failed = stream.events.find((event: StreamedEvent) => event.envelope.type === "tool.failed");
    expect(failed?.envelope.payload["message"]).toEqual(expect.stringContaining("transform.scale"));
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

  it("ends a resumed stream at once when the client already saw the run finish", async () => {
    const token = server.token("alice");
    const editor = await EditorSimulator.connect(server.wsUrl, token, "proj-resume-end");
    server.model.enqueue([assistantMessage("Done.")]);
    const run = await createRun(token, { projectId: "proj-resume-end", editorClientId: editor.clientId, message: "Say done" });

    const first = streamFor(run, token);
    const last = await first.waitFor((event) => event.envelope.type === "run.completed", 20_000);
    first.stop();
    if (last.id === undefined) throw new Error("The final event has no id");
    const lastEventId = last.id;

    // Without the fix the stream stays open, sending only heartbeats, until the client gives up.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    const response = await fetch(`${server.baseUrl}${run.eventsUrl}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "text/event-stream", "Last-Event-ID": lastEventId },
      signal: controller.signal,
    });
    const body = await response.text();
    clearTimeout(timer);
    expect(controller.signal.aborted).toBe(false);
    expect(body).not.toContain("run.completed");
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

describe("agent run: legacy approval infrastructure (test-only policy)", () => {
  beforeEach(() => {
    const tool = server.app.get(ToolRegistry).get("editor.apply_proposal");
    if (!tool) throw new Error("Missing apply tool");
    jest.spyOn(tool, "requiresApproval").mockResolvedValue(true);
  });
  afterEach(() => { jest.restoreAllMocks(); });
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
      modelResponder((call) => {
        expect(JSON.stringify(call.request.input)).toContain("Call editor.apply_proposal with this proposalId");
        expect(editor.executions).toHaveLength(0);
        return [functionCall("editor__apply_proposal", { proposalId: latestProposalId(call.request.input) }, { callId: "apply-d" })];
      }),
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
    // After the approved change the run checks the scene before it accepts the final reply.
    server.model.enqueue([functionCall("validation__check_scene", {}, { callId: "check-d" })], [assistantMessage("Removed the torso.")]);

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
    server.model.enqueue([functionCall("validation__check_scene", {}, { callId: "check-e" })], [assistantMessage("Done.")]);

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

  it("ends a run whose approvals expired unanswered, so the project accepts the next prompt", async () => {
    const token = server.token("gina");
    const editor = await EditorSimulator.connect(server.wsUrl, token, "proj-stale", torsoScene);
    const { run } = await startDeleteRun(token, "proj-stale", editor);
    server.app.get(DatabaseService).db
      .prepare("UPDATE approvals SET expires_at = ? WHERE run_id = ?")
      .run(new Date(Date.now() - 1000).toISOString(), run.runId);

    server.model.enqueue([assistantMessage("Renamed.")]);
    const next = await http<{ runId: string }>("POST", "/api/v1/agent-runs", { token, body: { projectId: "proj-stale", editorClientId: editor.clientId, message: "Rename it" } });
    expect(next.status).toBe(202);

    const stale = await http<RunRow>("GET", `/api/v1/agent-runs/${run.runId}`, { token });
    expect(stale.body.status).toBe("failed");
    expect(stale.body.error?.code).toBe("approval_expired");
    const settled = openEventStream(`${server.baseUrl}/api/v1/agent-runs/${next.body.runId}/events`, token);
    await settled.waitFor((event) => event.envelope.type === "run.completed", 20_000);
    settled.stop();
    editor.close();
  }, 40_000);

  it("refuses a second run on a project while one is still active, and accepts one after it is cancelled", async () => {
    const token = server.token("frank");
    const editor = await EditorSimulator.connect(server.wsUrl, token, "proj-busy", torsoScene);
    const { run } = await startDeleteRun(token, "proj-busy", editor);

    const second = await http<{ error?: { message?: string } }>("POST", "/api/v1/agent-runs", { token, body: { projectId: "proj-busy", editorClientId: editor.clientId, message: "Also rename it" } });
    expect(second.status).toBe(409);
    expect(JSON.stringify(second.body)).toContain("already working on this project");

    await http("POST", `/api/v1/agent-runs/${run.runId}/cancel`, { token });
    server.model.enqueue([assistantMessage("ok")]);
    const third = await http("POST", "/api/v1/agent-runs", { token, body: { projectId: "proj-busy", editorClientId: editor.clientId, message: "Now rename it" } });
    expect(third.status).toBe(202);
    editor.close();
  }, 40_000);
});

describe("agent run: continuation until the work is finished", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const box = (objectId: string) => [
    { commandId: `c-${objectId}`, type: "geometry.create_primitive", objectId, primitive: "box", size: 1, replaceExisting: false },
  ];
  const planStep = (id: string, title: string) => ({
    id,
    title,
    toolName: "editor.propose_commands",
    description: title,
    requiresApproval: false,
  });

  it("asks the model to carry on when it stops before the scene check, then accepts the reply", async () => {
    const token = server.token("gina");
    const editor = await EditorSimulator.connect(server.wsUrl, token, "proj-continue", torsoScene);
    server.model.enqueue(
      [functionCall("editor__propose_commands", { summary: "Add a cube", commands: box("cube") }, { callId: "propose-c" })],
      modelResponder((call) => [functionCall("editor__apply_proposal", { proposalId: latestProposalId(call.request.input) }, { callId: "apply-c" })]),
      // The reply comes before the check, so the run must not end here.
      [assistantMessage("I have added the cube.")],
      modelResponder((call) => {
        expect(JSON.stringify(call.request.input)).toContain("run validation.check_scene");
        return [functionCall("validation__check_scene", {}, { callId: "check-c" })];
      }),
      [assistantMessage("The cube is in the scene and the check passed.")],
    );
    try {
      const run = await createRun(token, { projectId: "proj-continue", editorClientId: editor.clientId, message: "Add a cube" });
      const stream = streamFor(run, token);
      try {
        const terminal = await stream.waitFor((event) => TERMINAL_TYPES.includes(event.envelope.type), 20_000);
        expect(terminal.envelope.type).toBe("run.completed");
        const continued = stream.events.filter((event) => event.envelope.type === "agent.continued");
        expect(continued).toHaveLength(1);
        expect(continued[0]?.envelope.payload).toMatchObject({ attempt: 1 });
      } finally {
        stream.stop();
      }
      const final = await http<RunRow>("GET", `/api/v1/agent-runs/${run.runId}`, { token });
      expect(final.body.finalOutput).toBe("The cube is in the scene and the check passed.");
      expect(editor.executions).toHaveLength(1);
    } finally {
      editor.close();
    }
  }, 30_000);

  // A request that asks for quality is reviewed by a separate agent once the builder has nothing left open. The scripted
  // model serves both agents from one queue, in the order the run calls them.
  const unitCube = { kind: "size", target: { id: "quality_ready_box" }, axis: "x", min: 0.9, max: 1.1, label: "Cube is one unit wide" };
  const recordBrief = (suffix: string) => functionCall("modeling__record_brief", { subject: "A unit cube", checks: [unitCube] }, { callId: `record-${suffix}` });
  const builds = (suffix: string, objectId = "quality_ready_box") => [
    [functionCall("editor__propose_commands", { summary: "Build the shape", commands: box(objectId) }, { callId: `propose-${suffix}` })],
    modelResponder((call) => [functionCall("editor__apply_proposal", { proposalId: latestProposalId(call.request.input) }, { callId: `apply-${suffix}` })]),
    [functionCall("validation__check_scene", {}, { callId: `scene-${suffix}` })],
    [functionCall("validation__check_brief", {}, { callId: `brief-${suffix}` })],
  ];
  const looksFromTwoViews = (suffix: string) => [functionCall("viewport__capture", { views: [{ preset: "front" }, { preset: "right" }] }, { callId: `capture-${suffix}` })];
  const verdict = (suffix: string, outcome: "ready" | "needs_refinement", findings: { aspect: string; observation: string; severity: "major" | "minor"; fix?: string }[], summary: string) =>
    [functionCall("modeling__assess_quality", { outcome, summary, findings }, { callId: `verdict-${suffix}` })];
  const approves = [{ aspect: "silhouette", observation: "The outline matches the request.", severity: "minor" as const }, { aspect: "proportions", observation: "The parts are in proportion.", severity: "minor" as const }];

  /** A bridge that gives each captured view its own camera position, as a real viewport does. */
  function distinctCameras() {
    const bridge = server.app.get<EditorBridge>(EDITOR_BRIDGE);
    const capture = bridge.captureViews.bind(bridge);
    jest.spyOn(bridge, "captureViews").mockImplementation(async (...args) => {
      const result = await capture(...args);
      return { ...result, images: result.images.map((image, index) => ({ ...image, camera: { ...image.camera, position: index === 0 ? [0, 0, 10] : [10, 0, 0] } })) };
    });
  }

  async function finish(token: string, projectId: string, editor: EditorSimulator, message: string) {
    const run = await createRun(token, { projectId, editorClientId: editor.clientId, dimension: "3d", message });
    const stream = streamFor(run, token);
    try {
      const terminal = await stream.waitFor((event) => TERMINAL_TYPES.includes(event.envelope.type), 20_000);
      const final = await http<RunRow>("GET", `/api/v1/agent-runs/${run.runId}`, { token });
      return { terminal: terminal.envelope.type, events: stream.events.map((event) => event.envelope), final: final.body };
    } finally { stream.stop(); }
  }

  it("has a separate agent review the finished work, and ends with the builder's reply once it passes", async () => {
    const token = server.token("review-pass");
    const editor = await EditorSimulator.connect(server.wsUrl, token, "proj-review-pass", torsoScene);
    distinctCameras();
    server.model.enqueue(
      [recordBrief("rp")],
      ...builds("rp"),
      [assistantMessage("I built the cube.")],
      // The reviewer starts here, with no memory of the build: it is given the request and the brief, not the builder's reply.
      modelResponder((call) => {
        const text = JSON.stringify(call.request.input);
        expect(text).toContain("Create a detailed cube");
        expect(text).toContain("Cube is one unit wide");
        expect(text).not.toContain("I built the cube.");
        expect(text).not.toContain("propose-rp");
        return [functionCall("editor__get_context", {}, { callId: "reviewer-context" })];
      }),
      looksFromTwoViews("rp"),
      verdict("rp", "ready", approves, "The requested shape is present."),
      [assistantMessage("Reviewed: it is right.")],
    );
    try {
      const { terminal, events, final } = await finish(token, "proj-review-pass", editor, "Create a detailed cube");
      expect(terminal).toBe("run.completed");
      expect(events.filter((event) => event.type === "agent.continued")).toHaveLength(0);
      expect(events.filter((event) => event.type === "review.started")).toHaveLength(1);
      expect(events.find((event) => event.type === "review.completed")?.payload).toMatchObject({ attempt: 1, outcome: "ready", findingCount: 2 });
      // The reply the user reads is the builder's; the reviewer's words stay out of it.
      expect(final.finalOutput).toBe("I built the cube.");
      // Six model calls to build and four to review: the run reports what it all cost.
      expect(final.usage?.requests).toBe(10);
    } finally { editor.close(); }
  }, 30_000);

  it("sends the reviewer's findings back to the builder as work, then reviews the fix", async () => {
    const token = server.token("review-fix");
    const editor = await EditorSimulator.connect(server.wsUrl, token, "proj-review-fix", torsoScene);
    distinctCameras();
    server.model.enqueue(
      [recordBrief("rf")],
      ...builds("rf"),
      [assistantMessage("Done.")],
      looksFromTwoViews("rf1"),
      verdict("rf1", "needs_refinement", [{ aspect: "legs", observation: "There are no legs under the cube.", severity: "major", fix: "Add four legs under the cube." }, { aspect: "paint", observation: "The color is flat.", severity: "minor" }], "Legs are missing."),
      [assistantMessage("Reviewed.")],
      modelResponder((call) => {
        const text = JSON.stringify(call.request.input);
        expect(text).toContain("an independent review of the result found 1 major problem");
        expect(text).toContain("legs: There are no legs under the cube. Fix: Add four legs under the cube.");
        expect(text).toContain("minor notes");
        return [functionCall("editor__propose_commands", { summary: "Add legs", commands: box("quality_ready_legs") }, { callId: "propose-legs" })];
      }),
      modelResponder((call) => [functionCall("editor__apply_proposal", { proposalId: latestProposalId(call.request.input) }, { callId: "apply-legs" })]),
      [functionCall("validation__check_scene", {}, { callId: "scene-legs" })],
      [functionCall("validation__check_brief", {}, { callId: "brief-legs" })],
      [assistantMessage("Added the legs.")],
      // The second reviewer is told what the first one asked for.
      modelResponder((call) => {
        expect(JSON.stringify(call.request.input)).toContain("A previous review asked for these fixes");
        return looksFromTwoViews("rf2");
      }),
      verdict("rf2", "ready", approves, "The legs are there."),
      [assistantMessage("Reviewed again.")],
    );
    try {
      const { terminal, events, final } = await finish(token, "proj-review-fix", editor, "Create a detailed cube");
      expect(terminal).toBe("run.completed");
      expect(events.filter((event) => event.type === "agent.continued")).toHaveLength(1);
      expect(events.filter((event) => event.type === "review.completed").map((event) => (event.payload as { outcome: string }).outcome)).toEqual(["needs_refinement", "ready"]);
      expect(final.finalOutput).toBe("Added the legs.");
    } finally { editor.close(); }
  }, 40_000);

  it("lets a reviewer that cannot see find fault from measurements, and never approve", async () => {
    const token = server.token("review-nopix");
    const editor = await EditorSimulator.connect(server.wsUrl, token, "proj-review-nopix", torsoScene);
    const bridge = server.app.get<EditorBridge>(EDITOR_BRIDGE);
    jest.spyOn(bridge, "captureViews").mockRejectedValue(new ServiceUnavailableError("Editor could not draw the view: No viewport is available in this run"));
    server.model.enqueue(
      [recordBrief("rn")],
      ...builds("rn"),
      [assistantMessage("Built.")],
      [functionCall("viewport__capture", { views: [{ preset: "front" }] }, { callId: "capture-rn1" })],
      modelResponder((call) => {
        expect(JSON.stringify(call.request.input)).toContain("No viewport is available");
        return verdict("rn1", "needs_refinement", [{ aspect: "legs", observation: "Only one object exists but a chair needs legs.", severity: "major", fix: "Add four legs." }], "Parts are missing.");
      }),
      [assistantMessage("Reviewed from measurements.")],
      modelResponder((call) => {
        expect(JSON.stringify(call.request.input)).toContain("Add four legs.");
        return [functionCall("editor__propose_commands", { summary: "Add legs", commands: box("quality_ready_legs") }, { callId: "propose-rn-legs" })];
      }),
      modelResponder((call) => [functionCall("editor__apply_proposal", { proposalId: latestProposalId(call.request.input) }, { callId: "apply-rn-legs" })]),
      [functionCall("validation__check_scene", {}, { callId: "scene-rn-legs" })],
      [functionCall("validation__check_brief", {}, { callId: "brief-rn-legs" })],
      [assistantMessage("Added legs.")],
      // It still cannot see, so the best it can say is that it could not judge.
      [functionCall("viewport__capture", { views: [{ preset: "front" }] }, { callId: "capture-rn2" })],
      [functionCall("modeling__assess_quality", { outcome: "blocked", summary: "No viewport, so the result was not visually verified.", findings: [{ aspect: "evidence", observation: "Pictures were unavailable.", severity: "major" }] }, { callId: "verdict-rn2" })],
      [assistantMessage("Could not judge.")],
    );
    try {
      const { terminal, events, final } = await finish(token, "proj-review-nopix", editor, "Create a detailed cube");
      expect(terminal).toBe("run.completed");
      expect(events.filter((event) => event.type === "review.completed").map((event) => (event.payload as { outcome: string }).outcome)).toEqual(["needs_refinement", "blocked"]);
      expect(final.finalOutput).toContain("Added legs.");
      expect(final.finalOutput).toContain("Quality review was blocked: No viewport, so the result was not visually verified.");
    } finally { jest.restoreAllMocks(); editor.close(); }
  }, 40_000);

  it("records a review that gives no verdict as blocked and says so", async () => {
    const token = server.token("review-silent");
    const editor = await EditorSimulator.connect(server.wsUrl, token, "proj-review-silent", torsoScene);
    server.model.enqueue(
      [recordBrief("rs")],
      ...builds("rs"),
      [assistantMessage("Built.")],
      [assistantMessage("Looks fine to me.")],
    );
    try {
      const { terminal, events, final } = await finish(token, "proj-review-silent", editor, "Create a detailed cube");
      expect(terminal).toBe("run.completed");
      expect(events.find((event) => event.type === "review.completed")?.payload).toMatchObject({ outcome: "blocked" });
      expect(final.finalOutput).toContain("Quality review was blocked: The reviewer finished without recording a verdict.");
    } finally { editor.close(); }
  }, 30_000);

  it("refuses a verdict from a reviewer that never looked at the scene", async () => {
    const token = server.token("review-blind");
    const editor = await EditorSimulator.connect(server.wsUrl, token, "proj-review-blind", torsoScene);
    server.model.enqueue(
      [recordBrief("rb")],
      ...builds("rb"),
      [assistantMessage("Built.")],
      verdict("rb1", "needs_refinement", [{ aspect: "legs", observation: "No legs.", severity: "major" }], "Legs are missing."),
      modelResponder((call) => {
        expect(JSON.stringify(call.request.input)).toContain("Look at the scene with viewport.capture before reporting problems");
        return [assistantMessage("I could not look.")];
      }),
    );
    try {
      const { final } = await finish(token, "proj-review-blind", editor, "Create a detailed cube");
      expect(final.finalOutput).toContain("Quality review was blocked");
    } finally { editor.close(); }
  }, 30_000);

  it("does not review a request that did not ask for quality", async () => {
    const token = server.token("review-none");
    const editor = await EditorSimulator.connect(server.wsUrl, token, "proj-review-none", torsoScene);
    server.model.enqueue(
      ...builds("rn"),
      [assistantMessage("Added a cube.")],
    );
    try {
      const { events, final } = await finish(token, "proj-review-none", editor, "Add a cube");
      expect(events.some((event) => event.type === "review.started")).toBe(false);
      expect(final.finalOutput).toBe("Added a cube.");
    } finally { editor.close(); }
  }, 30_000);

  it("keeps the builder from grading itself and the reviewer from changing the scene", async () => {
    const registry = server.app.get(AgentRegistry);
    const toolsOf = (id: string) => registry.agent(id).tools.map((tool) => tool.name);
    expect(toolsOf("modeling-coordinator")).not.toContain("modeling__assess_quality");
    expect(toolsOf("modeling-coordinator")).toContain("editor__apply_proposal");
    const reviewer = toolsOf("quality-reviewer");
    expect(reviewer).toContain("modeling__assess_quality");
    expect(reviewer).toContain("viewport__capture");
    for (const forbidden of ["editor__propose_commands", "editor__apply_proposal", "modeling__propose_generated", "modeling__generate_commands", "modeling__record_brief"]) expect(reviewer).not.toContain(forbidden);
    // The reviewer is not something a client can list or start a run with.
    const token = server.token("review-hidden");
    expect((await http<{ id: string }[]>("GET", "/api/v1/agents", { token })).body.map((agent) => agent.id)).toEqual(["modeling-coordinator"]);
    expect((await http("GET", "/api/v1/agents/quality-reviewer", { token })).status).toBe(404);
    expect((await http("POST", "/api/v1/agent-runs", { token, body: { projectId: "proj-hidden", message: "Hello there", agentId: "quality-reviewer" } })).status).toBe(404);
  });

  const onFloor = [{ kind: "position", target: { id: "brief_box" }, axis: "y", anchor: "min", min: 0, max: 0, label: "Box rests on the floor" }];
  const floating = (objectId: string) => [
    { commandId: `c-${objectId}`, type: "geometry.create_primitive", objectId, primitive: "box", size: 1, replaceExisting: false, transform: { position: [0, 2, 0] } },
  ];

  it("holds a run to its brief: the failing check is named, the model fixes the scene, and the run then finishes", async () => {
    const token = server.token("brief-fix");
    const editor = await EditorSimulator.connect(server.wsUrl, token, "proj-brief-fix", torsoScene);
    server.model.enqueue(
      [functionCall("modeling__record_brief", { subject: "A box on the floor", checks: onFloor }, { callId: "brief-1" })],
      [functionCall("editor__propose_commands", { summary: "Add a box", commands: floating("brief_box") }, { callId: "propose-b" })],
      modelResponder((call) => [functionCall("editor__apply_proposal", { proposalId: latestProposalId(call.request.input) }, { callId: "apply-b" })]),
      [functionCall("validation__check_scene", {}, { callId: "scene-b" })],
      [functionCall("validation__check_brief", {}, { callId: "check-b" })],
      modelResponder((call) => {
        // The box floats at 1.5, so the measured value and the needed value are both in front of the model.
        expect(JSON.stringify(call.request.input)).toContain("Box rests on the floor");
        return [assistantMessage("The box is placed.")];
      }),
      modelResponder((call) => {
        const text = JSON.stringify(call.request.input);
        expect(text).toContain("1 of 1 brief checks do not pass");
        expect(text).toContain("1.5, needs exactly 0");
        return [functionCall("editor__propose_commands", { summary: "Lower the box", commands: [{ commandId: "lower", type: "scene.transform_object", objectId: "brief_box", transform: { position: [0, 0.5, 0] } }] }, { callId: "propose-fix" })];
      }),
      modelResponder((call) => [functionCall("editor__apply_proposal", { proposalId: latestProposalId(call.request.input) }, { callId: "apply-fix" })]),
      [functionCall("validation__check_scene", {}, { callId: "scene-fix" })],
      [functionCall("validation__check_brief", {}, { callId: "check-fix" })],
      [assistantMessage("The box now rests on the floor.")],
    );
    try {
      const run = await createRun(token, { projectId: "proj-brief-fix", editorClientId: editor.clientId, dimension: "3d", message: "Put a box on the floor" });
      const stream = streamFor(run, token);
      try {
        const terminal = await stream.waitFor((event) => TERMINAL_TYPES.includes(event.envelope.type), 20_000);
        expect(terminal.envelope.type).toBe("run.completed");
        expect(stream.events.filter((event) => event.envelope.type === "agent.continued")).toHaveLength(1);
      } finally { stream.stop(); }
      const final = await http<RunRow>("GET", `/api/v1/agent-runs/${run.runId}`, { token });
      expect(final.body.finalOutput).toBe("The box now rests on the floor.");
    } finally { editor.close(); }
  }, 30_000);

  it("tells the user when the run ends with a brief check still failing", async () => {
    const token = server.token("brief-giveup");
    const editor = await EditorSimulator.connect(server.wsUrl, token, "proj-brief-giveup", torsoScene);
    server.model.enqueue(
      [functionCall("modeling__record_brief", { subject: "A box on the floor", checks: onFloor }, { callId: "brief-2" })],
      [functionCall("editor__propose_commands", { summary: "Add a box", commands: floating("brief_box") }, { callId: "propose-g" })],
      modelResponder((call) => [functionCall("editor__apply_proposal", { proposalId: latestProposalId(call.request.input) }, { callId: "apply-g" })]),
      [functionCall("validation__check_scene", {}, { callId: "scene-g" })],
      [functionCall("validation__check_brief", {}, { callId: "check-g" })],
      [assistantMessage("The box is placed.")],
      // The reminder gets an answer without a tool call: the model has chosen to stop, and the run ends honestly.
      [assistantMessage("I could not lower it.")],
    );
    try {
      const run = await createRun(token, { projectId: "proj-brief-giveup", editorClientId: editor.clientId, dimension: "3d", message: "Put a box on the floor" });
      const stream = streamFor(run, token);
      try {
        const terminal = await stream.waitFor((event) => TERMINAL_TYPES.includes(event.envelope.type), 20_000);
        expect(terminal.envelope.type).toBe("run.completed");
      } finally { stream.stop(); }
      const final = await http<RunRow>("GET", `/api/v1/agent-runs/${run.runId}`, { token });
      expect(final.body.finalOutput).toContain("I could not lower it.");
      expect(final.body.finalOutput).toContain("1 of 1 brief checks do not pass: Box rests on the floor: 1.5, needs exactly 0");
    } finally { editor.close(); }
  }, 30_000);

  it("marks the brief as unmeasured when the scene changes after its check", async () => {
    const token = server.token("brief-stale");
    const editor = await EditorSimulator.connect(server.wsUrl, token, "proj-brief-stale", torsoScene);
    server.model.enqueue(
      [functionCall("modeling__record_brief", { subject: "A box on the floor", checks: onFloor }, { callId: "brief-3" })],
      [functionCall("editor__propose_commands", { summary: "Add a box", commands: box("brief_box") }, { callId: "propose-s" })],
      modelResponder((call) => [functionCall("editor__apply_proposal", { proposalId: latestProposalId(call.request.input) }, { callId: "apply-s" })]),
      [functionCall("validation__check_scene", {}, { callId: "scene-s" })],
      [functionCall("validation__check_brief", {}, { callId: "check-s" })],
      [functionCall("editor__propose_commands", { summary: "Move the box", commands: [{ commandId: "nudge", type: "scene.transform_object", objectId: "brief_box", transform: { position: [1, 0, 0] } }] }, { callId: "propose-s2" })],
      modelResponder((call) => [functionCall("editor__apply_proposal", { proposalId: latestProposalId(call.request.input) }, { callId: "apply-s2" })]),
      [functionCall("validation__check_scene", {}, { callId: "scene-s2" })],
      [assistantMessage("Done.")],
      modelResponder((call) => {
        expect(JSON.stringify(call.request.input)).toContain("the scene changed after the brief was last measured");
        return [assistantMessage("Done, unchecked.")];
      }),
    );
    try {
      const run = await createRun(token, { projectId: "proj-brief-stale", editorClientId: editor.clientId, dimension: "3d", message: "Put a box on the floor" });
      const stream = streamFor(run, token);
      try {
        const terminal = await stream.waitFor((event) => TERMINAL_TYPES.includes(event.envelope.type), 20_000);
        expect(terminal.envelope.type).toBe("run.completed");
      } finally { stream.stop(); }
      const final = await http<RunRow>("GET", `/api/v1/agent-runs/${run.runId}`, { token });
      expect(final.body.finalOutput).toContain("not measured on the final scene");
    } finally { editor.close(); }
  }, 30_000);

  it("stops asking after the continuation limit and accepts the last reply", async () => {
    const token = server.token("hank");
    const editor = await EditorSimulator.connect(server.wsUrl, token, "proj-limit", torsoScene);
    server.model.enqueue(
      // The batch is proposed and never applied, so work stays open. Each continuation acts with a tool call,
      // which is what lets the run keep asking until the limit is reached.
      [functionCall("editor__propose_commands", { summary: "Add a cube", commands: box("cube") }, { callId: "propose-l" })],
      [assistantMessage("Ready.")],
      [functionCall("editor__get_context", {}, { callId: "look-1" })],
      [assistantMessage("Still checking.")],
      [functionCall("editor__get_context", {}, { callId: "look-2" })],
      [assistantMessage("Still checking.")],
      [functionCall("editor__get_context", {}, { callId: "look-3" })],
      [assistantMessage("Still checking.")],
      [functionCall("editor__get_context", {}, { callId: "look-4" })],
      [assistantMessage("Still checking.")],
      [functionCall("editor__get_context", {}, { callId: "look-5" })],
      [assistantMessage("Final answer.")],
    );
    try {
      const run = await createRun(token, { projectId: "proj-limit", editorClientId: editor.clientId, message: "Add a cube" });
      const stream = streamFor(run, token);
      try {
        const terminal = await stream.waitFor((event) => TERMINAL_TYPES.includes(event.envelope.type), 20_000);
        expect(terminal.envelope.type).toBe("run.completed");
        const continued = stream.events.filter((event) => event.envelope.type === "agent.continued");
        expect(continued).toHaveLength(5);
      } finally {
        stream.stop();
      }
      const final = await http<RunRow>("GET", `/api/v1/agent-runs/${run.runId}`, { token });
      expect(final.body.finalOutput).toBe("Final answer.");
      expect(editor.executions).toHaveLength(0);
    } finally {
      editor.close();
    }
  }, 30_000);

  it("does not repeat a question when the model answers the continuation without acting", async () => {
    const token = server.token("jade");
    const editor = await EditorSimulator.connect(server.wsUrl, token, "proj-question", torsoScene);
    server.model.enqueue(
      [functionCall("editor__propose_commands", { summary: "Add a cube", commands: box("cube") }, { callId: "propose-q" })],
      [assistantMessage("Which colour should the cube be?")],
      // The model answers the request to continue with the same question and no tool call: the run ends there.
      [assistantMessage("Which colour should the cube be?")],
    );
    try {
      const run = await createRun(token, { projectId: "proj-question", editorClientId: editor.clientId, message: "Add a cube" });
      const stream = streamFor(run, token);
      try {
        const terminal = await stream.waitFor((event) => TERMINAL_TYPES.includes(event.envelope.type), 20_000);
        expect(terminal.envelope.type).toBe("run.completed");
        expect(stream.events.filter((event) => event.envelope.type === "agent.continued")).toHaveLength(1);
      } finally {
        stream.stop();
      }
      const final = await http<RunRow>("GET", `/api/v1/agent-runs/${run.runId}`, { token });
      expect(final.body.finalOutput).toBe("Which colour should the cube be?");
    } finally {
      editor.close();
    }
  }, 30_000);

  it("keeps the plan and the applied steps across an approval pause", async () => {
    const token = server.token("ivy");
    const editor = await EditorSimulator.connect(server.wsUrl, token, "proj-plan-pause", torsoScene);
    // Only the first apply waits for approval; the next one runs at once.
    const tool = server.app.get(ToolRegistry).get("editor.apply_proposal");
    if (!tool) throw new Error("Missing apply tool");
    jest.spyOn(tool, "requiresApproval").mockResolvedValueOnce(true).mockResolvedValue(false);

    server.model.enqueue(
      [
        functionCall(
          "modeling__generate_model_plan",
          { goal: "Two blocks", dimension: "3d", steps: [planStep("s1", "Left block"), planStep("s2", "Right block")] },
          { callId: "plan-p" },
        ),
      ],
      [functionCall("editor__propose_commands", { summary: "Left block", commands: box("left"), stepId: "s1" }, { callId: "propose-left" })],
      modelResponder((call) => [functionCall("editor__apply_proposal", { proposalId: latestProposalId(call.request.input) }, { callId: "apply-left" })]),
      // This turn runs after the approval, so the plan has to come back with the resumed run.
      [functionCall("editor__propose_commands", { summary: "Right block", commands: box("right"), stepId: "s2" }, { callId: "propose-right" })],
      modelResponder((call) => [functionCall("editor__apply_proposal", { proposalId: latestProposalId(call.request.input) }, { callId: "apply-right" })]),
      [functionCall("validation__check_scene", {}, { callId: "check-p" })],
      [assistantMessage("Both blocks are placed.")],
    );
    try {
      const run = await createRun(token, { projectId: "proj-plan-pause", editorClientId: editor.clientId, message: "Build two blocks", dimension: "3d" });
      const waiting = streamFor(run, token);
      const required = await waiting.waitFor((event) => event.envelope.type === "approval.required", 20_000);
      waiting.stop();

      const approvals = await http<ApprovalRow[]>("GET", `/api/v1/agent-runs/${run.runId}/approvals`, { token });
      const decided = await http("POST", `/api/v1/agent-runs/${run.runId}/approvals/${approvals.body[0]?.id ?? ""}`, {
        token,
        body: { decision: "approve" },
      });
      expect(decided.status).toBe(200);

      const resumed = streamFor(run, token, required.id);
      try {
        const terminal = await resumed.waitFor((event) => TERMINAL_TYPES.includes(event.envelope.type), 20_000);
        expect(terminal.envelope.type).toBe("run.completed");
        // The second batch names its step, and the editor accepts the step only if the plan survived the pause.
        const proposed = resumed.events.filter((event) => event.envelope.type === "editor.proposal.created");
        expect(proposed.at(-1)?.envelope.payload).toMatchObject({ planStepId: "s2" });
      } finally {
        resumed.stop();
      }
      expect(editor.executions).toHaveLength(2);
    } finally {
      editor.close();
    }
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
