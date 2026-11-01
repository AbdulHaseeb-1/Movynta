import type { AgentInputItem } from "@openai/agents";
import { assistantMessage, functionCall, modelResponder } from "@openai/agents/testing";
import { AgentRegistry } from "../modules/agents/agent.registry.js";
import { ALL_TOOL_NAMES, MODELING_TOOLSET, TOOL_NAMES } from "../modules/tools/catalog/index.js";
import { toProviderToolName, type ToolCatalogView } from "../modules/tools/tool.types.js";
import { EditorSimulator } from "../testing/editor-simulator.js";
import { openEventStream } from "../testing/event-stream.js";
import { startTestServer } from "../testing/test-app.js";
import type { StreamedEvent, TestServer } from "../testing/testing.types.js";

let server: TestServer;

beforeAll(async () => {
  server = await startTestServer();
}, 60_000);

afterAll(async () => {
  await server.close();
});

const PROPOSAL_ID = /prp_[0-9a-f-]{36}/g;

function latestProposalId(input: string | AgentInputItem[]): string {
  const matches = [...(typeof input === "string" ? input : JSON.stringify(input)).matchAll(PROPOSAL_ID)];
  const latest = matches[matches.length - 1]?.[0];
  if (latest === undefined) throw new Error("No proposal id in the conversation");
  return latest;
}

async function startRun(token: string, body: Record<string, unknown>): Promise<{ runId: string; eventsUrl: string }> {
  const response = await fetch(`${server.baseUrl}/api/v1/agent-runs`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(response.status).toBe(202);
  return (await response.json()) as { runId: string; eventsUrl: string };
}

describe("tool catalog endpoint", () => {
  it("requires authentication", async () => {
    expect((await fetch(`${server.baseUrl}/api/v1/tools`)).status).toBe(401);
  });

  it("lists every catalog tool with its schema and the toolsets", async () => {
    const response = await fetch(`${server.baseUrl}/api/v1/tools`, { headers: { Authorization: `Bearer ${server.token("alice")}` } });
    expect(response.status).toBe(200);
    const view = (await response.json()) as ToolCatalogView;
    expect(view.tools.map((tool) => tool.name).sort()).toEqual([...ALL_TOOL_NAMES].sort());
    for (const tool of view.tools) {
      expect(tool.inputSchema["type"]).toBe("object");
      expect(tool.providerName).toBe(toProviderToolName(tool.name));
    }
    expect(view.toolsets.map((toolset) => toolset.id)).toContain(MODELING_TOOLSET.id);
  });
});

describe("agent tool access", () => {
  it("gives the modeling coordinator exactly the tools of its toolset, under provider names", () => {
    const agent = server.app.get(AgentRegistry).agent("modeling-coordinator");
    const names = agent.tools.map((tool) => ("name" in tool ? tool.name : ""));
    expect(names).toEqual(MODELING_TOOLSET.toolNames.map(toProviderToolName));
  });

  it("lets the agent call every tool through the real run pipeline, with strict-mode nulls", async () => {
    const token = server.token("alice");
    const editor = await EditorSimulator.connect(server.wsUrl, token, "proj-tools");

    server.model.enqueue(
      [functionCall("skills__load_skill", { skillId: "character-modeling" }, { callId: "t1" })],
      [functionCall("editor__get_scene_summary", {}, { callId: "t2" })],
      [functionCall("editor__get_context", {}, { callId: "t3" })],
      [
        functionCall(
          "modeling__generate_model_plan",
          {
            goal: "Blocky torso",
            dimension: "3d",
            // The model sees provider names, so it may use them inside the plan too.
            steps: [{ id: "torso", title: "Torso", toolName: "editor__propose_commands", description: "One box", requiresApproval: false }],
          },
          { callId: "t4" },
        ),
      ],
      [
        functionCall(
          "editor__propose_commands",
          {
            summary: "Add a torso",
            commands: [
              { commandId: "c1", type: "scene.create_object", objectId: "torso", name: "Torso", parentId: null, transform: null },
              { commandId: "c2", type: "geometry.create_primitive", objectId: "head", primitive: "box", size: 1, replaceExisting: false },
              { commandId: "c3", type: "scene.transform_object", objectId: "head", transform: { position: [0, 2, 0], rotation: null, scale: null } },
            ],
          },
          { callId: "t5" },
        ),
      ],
      modelResponder((call) => [
        functionCall("editor__apply_proposal", { proposalId: latestProposalId(call.request.input) }, { callId: "t6" }),
      ]),
      [functionCall("validation__check_scene", {}, { callId: "t7" })],
      [assistantMessage("Done.")],
    );

    const run = await startRun(token, {
      projectId: "proj-tools",
      editorClientId: editor.clientId,
      message: "Create a 3D humanoid character with a torso",
      dimension: "3d",
    });
    const stream = openEventStream(server.baseUrl + run.eventsUrl, token);
    const terminal = await stream.waitFor((event) => ["run.completed", "run.failed"].includes(event.envelope.type ?? ""), 20_000);
    stream.stop();
    expect(terminal.envelope).toMatchObject({ type: "run.completed" });

    const payloadOf = (event: StreamedEvent): { toolName?: string } => event.envelope.payload as { toolName?: string };
    const completed = stream.events.filter((event) => event.envelope.type === "tool.completed").map((event) => payloadOf(event).toolName);
    const failed = stream.events.filter((event) => event.envelope.type === "tool.failed").map((event) => payloadOf(event).toolName);
    expect(failed).toEqual([]);
    expect([...completed].sort()).toEqual([...ALL_TOOL_NAMES].sort());
    expect(completed).toEqual([
      TOOL_NAMES.skillsLoadSkill,
      TOOL_NAMES.editorGetSceneSummary,
      TOOL_NAMES.editorGetContext,
      TOOL_NAMES.modelingGeneratePlan,
      TOOL_NAMES.editorProposeCommands,
      TOOL_NAMES.editorApplyProposal,
      TOOL_NAMES.validationCheckScene,
    ]);
    expect(editor.executions[0]?.commands.map((command) => command.type)).toEqual(["scene.create_object", "geometry.create_primitive", "scene.transform_object"]);
    editor.close();
  }, 30_000);

  it("tells the model how to recover from invalid arguments, and the run continues", async () => {
    const token = server.token("alice");
    const editor = await EditorSimulator.connect(server.wsUrl, token, "proj-recover");
    let sawRecoveryHint = false;

    server.model.enqueue(
      [functionCall("editor__apply_proposal", { proposalId: "bad id with spaces" }, { callId: "r1" })],
      modelResponder((call) => {
        sawRecoveryHint = JSON.stringify(call.request.input).includes("did not match its schema");
        return [assistantMessage("I will fix the proposal id.")];
      }),
    );

    const run = await startRun(token, { projectId: "proj-recover", editorClientId: editor.clientId, message: "Apply my proposal" });
    const stream = openEventStream(server.baseUrl + run.eventsUrl, token);
    const terminal = await stream.waitFor((event) => ["run.completed", "run.failed"].includes(event.envelope.type ?? ""), 20_000);
    stream.stop();
    expect(terminal.envelope).toMatchObject({ type: "run.completed" });
    expect(sawRecoveryHint).toBe(true);
    const failures = stream.events.filter((event) => event.envelope.type === "tool.failed");
    expect(failures.map((event) => (event.envelope.payload as { toolName?: string }).toolName)).toEqual([TOOL_NAMES.editorApplyProposal]);
    editor.close();
  }, 30_000);
});
