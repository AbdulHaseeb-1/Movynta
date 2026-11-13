import { RunContext, tool } from "@openai/agents";
import { createEditorTools } from "./editor/editor.tools.js";
import { createBriefTools } from "./modeling/brief.tools.js";
import { createModelingTools } from "./modeling/modeling.tools.js";
import { createProceduralTools } from "./procedural/index.js";
import { createViewportTools } from "./viewport/index.js";
import { z } from "zod";
import { editorCommandListSchema } from "@movynta/editor-protocol";
import type { AgentRunContext, ToolOutputEntry } from "../agent-runs/agent-runs.types.js";
import { emptyRunProgress } from "../agent-runs/run-progress.js";
import { ValidationFailedError } from "../../common/errors/app-error.js";
import { closestValues, formatIssuePath } from "./tool-input-issues.js";
import { toSdkTool } from "./tool.sdk-adapter.js";
import { defineTool } from "./tool.types.js";

interface Emitted {
  readonly type: string;
  readonly payload: Record<string, unknown>;
}

function contextFor(emitted: Emitted[], kept: ToolOutputEntry[] = []): AgentRunContext {
  return {
    runId: "run_test",
    userId: "user_test",
    projectId: "project_test",
    sessionId: "session_test",
    clientId: "client_test",
    dimension: "3d",
    selectedSkillIds: [],
    events: { emit: (type: string, payload: Record<string, unknown>) => emitted.push({ type, payload }) },
    toolOutputs: {
      save: (entry: ToolOutputEntry) => {
        kept.push(entry);
        return `out_${kept.length}`;
      },
    },
    signal: new AbortController().signal,
    progress: emptyRunProgress(),
    supportsToolImages: false,
  } as unknown as AgentRunContext;
}

const proposeLike = defineTool({
  name: "test.propose",
  description: "Takes a batch of commands.",
  permission: "propose",
  parameters: z.object({ summary: z.string().min(1), commands: editorCommandListSchema, note: z.string().optional() }).strict(),
  execute: (input) => ({ received: input.commands.length, note: input.note ?? null }),
});

async function invoke(
  definition: ReturnType<typeof defineTool>,
  args: unknown,
  emitted: Emitted[] = [],
  kept: ToolOutputEntry[] = [],
) {
  const sdkTool = toSdkTool(definition);
  const output = await sdkTool.invoke(new RunContext<AgentRunContext>(contextFor(emitted, kept)), JSON.stringify(args));
  return JSON.parse(String(output)) as Record<string, unknown>;
}

describe("tool calls the schema refuses", () => {
  it("tell the model which field of which command to fix, instead of a bare retry message", async () => {
    const emitted: Emitted[] = [];
    const result = await invoke(proposeLike, {
      summary: "Resize",
      note: null,
      commands: [
        { commandId: "lid", type: "scene.transform_object", objectId: "box", transform: { scale: [1, 2] } },
        { commandId: "spin", type: "scene.rotate_object", objectId: "box" },
      ],
    }, emitted);
    expect(result["error"]).toMatch(/do not match this tool's schema/);
    expect(result["issues"]).toEqual([
      { path: 'commands[0] (commandId "lid").transform.scale', message: expect.stringMatching(/exactly 3/) },
      { path: 'commands[1] (commandId "spin").type', message: expect.stringMatching(/^Unknown value "scene.rotate_object". Closest valid values: /) },
    ]);
    // The chat shows the failure as well, not just a tool that started and never ended.
    expect(emitted.map((event) => event.type)).toEqual(["tool.started", "tool.failed"]);
    expect(String(emitted[1]?.payload["message"])).toContain('commands[0] (commandId "lid").transform.scale');
  });

  it("still accept the nulls strict mode sends for left-out optional fields", async () => {
    const result = await invoke(proposeLike, {
      summary: "Hide",
      note: null,
      commands: [{ commandId: "hide", type: "scene.set_visibility", objectId: "box", visible: false }],
    });
    expect(result).toEqual({ received: 1, note: null });
  });

  it("send the model exactly the JSON schema the SDK builds from the tool's own schema, for every tool", () => {
    const tools = [
      ...createEditorTools({ bridge: {} as never, proposals: {} as never }),
      ...createModelingTools({ knownToolNames: [] }),
      ...createBriefTools({} as never),
      ...createProceduralTools({ bridge: {} as never, proposals: {} as never }),
      ...createViewportTools({ bridge: {} as never, proposals: {} as never }),
    ];
    for (const definition of tools) {
      const direct = tool({ name: "same", description: "", parameters: definition.parameters, execute: () => null });
      expect(toSdkTool(definition).parameters).toEqual(direct.parameters);
    }
  });

  it("pass on the message of a domain error the tool raises", async () => {
    const failing = defineTool({
      name: "test.fails",
      description: "x",
      permission: "read",
      parameters: z.object({}).strict(),
      execute: () => {
        throw new ValidationFailedError("Supply objects in increasing spatial order on the chosen axis");
      },
    });
    expect(await invoke(failing, {})).toEqual({ error: "Supply objects in increasing spatial order on the chosen axis" });
  });

  const echo = defineTool({
    name: "test.echo",
    description: "Returns the word it is given.",
    permission: "read",
    parameters: z.object({ word: z.string() }).strict(),
    execute: (input) => ({ echoed: input.word }),
  });

  it("keep what a call received and returned, and name the kept output in the completion event", async () => {
    const emitted: Emitted[] = [];
    const kept: ToolOutputEntry[] = [];
    expect(await invoke(echo, { word: "hi" }, emitted, kept)).toEqual({ echoed: "hi" });

    expect(kept).toEqual([{ toolName: "test.echo", input: '{"word":"hi"}', output: '{"echoed":"hi"}' }]);
    expect(emitted.find((event) => event.type === "tool.completed")?.payload).toEqual({
      toolName: "test.echo",
      durationMs: expect.any(Number),
      outputId: "out_1",
    });
  });

  it("keep a failed call's result too, so its failed step can show what went wrong", async () => {
    const emitted: Emitted[] = [];
    const kept: ToolOutputEntry[] = [];
    const failing = defineTool({
      name: "test.refuses",
      description: "x",
      permission: "read",
      parameters: z.object({}).strict(),
      execute: () => {
        throw new ValidationFailedError("No such object");
      },
    });
    await invoke(failing, {}, emitted, kept);

    expect(kept).toEqual([{ toolName: "test.refuses", input: "{}", output: '{"error":"No such object"}' }]);
    expect(emitted.at(-1)).toMatchObject({ type: "tool.failed", payload: { outputId: "out_1" } });
  });

  it("still answer the model when its output cannot be kept", async () => {
    const context = {
      ...contextFor([]),
      toolOutputs: {
        save: () => {
          throw new Error("disk full");
        },
      },
    } as AgentRunContext;
    const output = await toSdkTool(echo).invoke(new RunContext<AgentRunContext>(context), '{"word":"hi"}');
    expect(JSON.parse(String(output))).toEqual({ echoed: "hi" });
  });
});

describe("issue formatting", () => {
  it("names the command a path runs through", () => {
    expect(formatIssuePath(["commands", 1, "ids", 0], { commands: [{}, { commandId: "cut", ids: ["x"] }] })).toBe('commands[1] (commandId "cut").ids[0]');
    expect(formatIssuePath([])).toBe("(arguments)");
  });

  it("suggests the closest command types", () => {
    expect(closestValues("geometry.extrude_faces", ["geometry.extrude", "scene.move_object", "geometry.inset_faces", "geometry.bevel"])[0]).toBe("geometry.extrude");
  });
});
