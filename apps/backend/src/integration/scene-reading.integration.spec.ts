import { assistantMessage, functionCall, modelResponder } from "@openai/agents/testing";
import { startTestServer } from "../testing/test-app.js";
import { openEventStream } from "../testing/event-stream.js";
import { EditorSimulator } from "../testing/editor-simulator.js";
import { buildingObjects } from "../testing/scene-fixtures.js";
import type { TestServer } from "../testing/testing.types.js";

let server: TestServer;

beforeAll(async () => {
  server = await startTestServer();
}, 60_000);

afterAll(async () => {
  await server.close();
});

/** The text of the most recent tool result in a request to the model. */
function lastToolOutput(input: unknown): string {
  const items = Array.isArray(input) ? input : [];
  for (let at = items.length - 1; at >= 0; at -= 1) {
    const item = items[at] as { type?: string; output?: unknown } | undefined;
    if (item?.type !== "function_call_result") continue;
    // A result reaches the model as text, either directly or as a text part.
    const output = item.output as string | { text?: string } | undefined;
    return typeof output === "string" ? output : (output?.text ?? "");
  }
  return "";
}

describe("a run on a large scene", () => {
  it("reads it by branch, finds the repeats and selects by rule, without the full context", async () => {
    const token = server.token("alice-scene");
    const objects = buildingObjects({ floors: 12, columns: 20 });
    const editor = await EditorSimulator.connect(server.wsUrl, token, "proj-large-scene", objects);
    const seen: string[] = [];
    server.model.enqueue(
      [functionCall("editor__read_branch", {}, { callId: "top" })],
      modelResponder((call) => {
        seen.push(lastToolOutput(call.request.input));
        return [functionCall("editor__read_branch", { rootId: "facade" }, { callId: "facade" })];
      }),
      modelResponder((call) => {
        seen.push(lastToolOutput(call.request.input));
        return [functionCall("editor__find_repeats", {}, { callId: "repeats" })];
      }),
      modelResponder((call) => {
        seen.push(lastToolOutput(call.request.input));
        return [functionCall("editor__query_objects", { nameMatches: "window*", position: { y: { min: 24 } }, countOnly: true }, { callId: "query" })];
      }),
      modelResponder((call) => {
        seen.push(lastToolOutput(call.request.input));
        return [assistantMessage("The facade is 240 windows in a 20 by 12 grid.")];
      }),
    );
    try {
      const response = await fetch(`${server.baseUrl}/api/v1/agent-runs`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: "proj-large-scene", editorClientId: editor.clientId, message: "Describe the facade" }),
      });
      expect(response.status).toBe(202);
      const run = (await response.json()) as { eventsUrl: string };
      const stream = openEventStream(server.baseUrl + run.eventsUrl, token);
      try {
        const terminal = await stream.waitFor((event) => ["run.completed", "run.failed"].includes(event.envelope.type), 20_000);
        expect(terminal.envelope.type).toBe("run.completed");
        const tools = stream.events.filter((event) => event.envelope.type === "tool.completed").map((event) => event.envelope.payload["toolName"]);
        expect(tools).toEqual(["editor.read_branch", "editor.read_branch", "editor.find_repeats", "editor.query_objects"]);
      } finally {
        stream.stop();
      }

      const [top, facade, repeats, query] = seen.map((text) => JSON.parse(text) as Record<string, unknown>);
      expect(top).toMatchObject({ objectCount: objects.length, children: [{ id: "building", descendantCount: 3 + 240 * 3 }] });
      expect(facade?.["children"]).toEqual([expect.objectContaining({ repeat: true, count: 240, descendantsEach: 2 })]);
      expect(repeats?.["groups"]).toEqual([expect.objectContaining({ name: "Window", count: 240, arrangement: { kind: "grid", axes: ["x", "y"], counts: [20, 12], steps: [1.2, 3] } })]);
      expect(query).toMatchObject({ total: 4 * 20 });
      // Nothing here changes the scene.
      expect(editor.executions).toHaveLength(0);
      // Each answer is a small fraction of the flat scene.
      const flat = JSON.stringify(editor.scene).length;
      for (const text of seen.slice(0, 3)) expect(text.length).toBeLessThan(flat / 20);
    } finally {
      editor.close();
    }
  }, 40_000);
});
