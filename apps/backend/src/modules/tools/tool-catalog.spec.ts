import { RunContext } from "@openai/agents";
import { z } from "zod";
import { ValidationFailedError } from "../../common/errors/app-error.js";
import type { AgentRunContext } from "../agent-runs/agent-runs.types.js";
import { ALL_TOOL_NAMES, isToolName, MODELING_TOOLSET, TOOL_NAMES, TOOLSETS } from "./catalog/index.js";
import { createEditorTools } from "./editor/editor.tools.js";
import { createModelingTools } from "./modeling/modeling.tools.js";
import { createSkillTools } from "./skills/skills.tools.js";
import { MAX_TOOL_OUTPUT_CHARS, toSdkTool } from "./tool.factory.js";
import { ToolRegistry } from "./tool.registry.js";
import { defineTool, describeTool, fromProviderToolName, toProviderToolName, type ToolDefinition } from "./tool.types.js";
import { createValidationTools } from "./validation/validation.tools.js";

const emitted: { type: string; payload: unknown }[] = [];
const proposeInputs: unknown[] = [];

const stubBridge = {
  assertConnection: () => undefined,
  getContext: () => Promise.resolve({ projectId: "p", revision: 1, activeSceneName: "Main", selectedObjectIds: [], objects: [] }),
};
const stubProposals = {
  propose: (_run: unknown, input: unknown) => {
    proposeInputs.push(input);
    return Promise.resolve({ id: "prp_1", status: "proposed", requiresApproval: false, commands: [{}], baseRevision: 1, summary: "s" });
  },
};

function buildTools(): ToolDefinition[] {
  return [
    ...createEditorTools({ bridge: stubBridge as never, proposals: stubProposals as never }),
    ...createValidationTools({ bridge: stubBridge as never }),
    ...createSkillTools({ skills: { get: () => undefined } as never }),
    ...createModelingTools(),
  ];
}

function runContext(): RunContext<AgentRunContext> {
  const context: AgentRunContext = {
    runId: "run_1",
    userId: "u1",
    projectId: "p",
    sessionId: "s",
    clientId: "c",
    dimension: undefined,
    selectedSkillIds: [],
    events: { emit: (type: string, payload: unknown) => void emitted.push({ type, payload }) } as never,
    signal: new AbortController().signal,
    plans: [],
  };
  return new RunContext(context);
}

/** Collects JSON Schema constructs that strict model providers reject. */
function strictProblems(schema: unknown, path = "#"): string[] {
  if (Array.isArray(schema)) return schema.flatMap((item, index) => strictProblems(item, `${path}/${index}`));
  if (typeof schema !== "object" || schema === null) return [];
  const record = schema as Record<string, unknown>;
  const found: string[] = [];
  if (Array.isArray(record["items"])) found.push(`${path}: tuple "items" array`);
  if ("prefixItems" in record) found.push(`${path}: "prefixItems"`);
  const properties = record["properties"];
  if (typeof properties === "object" && properties !== null) {
    if (record["additionalProperties"] !== false) found.push(`${path}: object without additionalProperties:false`);
    const required = Array.isArray(record["required"]) ? record["required"] : [];
    const missing = Object.keys(properties).filter((key) => !required.includes(key));
    if (missing.length > 0) found.push(`${path}: optional properties in strict mode (${missing.join(", ")})`);
  }
  for (const [key, value] of Object.entries(record)) found.push(...strictProblems(value, `${path}/${key}`));
  return found;
}

beforeEach(() => {
  emitted.length = 0;
  proposeInputs.length = 0;
});

describe("tool catalog", () => {
  it("has unique, well-formed names and a matching provider-name round trip", () => {
    expect(new Set(ALL_TOOL_NAMES).size).toBe(ALL_TOOL_NAMES.length);
    for (const name of ALL_TOOL_NAMES) {
      expect(name).toMatch(/^[a-z_]+\.[a-z_]+$/);
      expect(fromProviderToolName(toProviderToolName(name))).toBe(name);
      expect(isToolName(name)).toBe(true);
    }
    expect(isToolName("shell.exec")).toBe(false);
  });

  it("is implemented exactly by the tool factories", () => {
    expect(buildTools().map((tool) => tool.name).sort()).toEqual([...ALL_TOOL_NAMES].sort());
  });

  it("gives the modeling coordinator every tool, each exactly once", () => {
    expect([...MODELING_TOOLSET.toolNames].sort()).toEqual([...ALL_TOOL_NAMES].sort());
    expect(new Set(MODELING_TOOLSET.toolNames).size).toBe(MODELING_TOOLSET.toolNames.length);
  });

  it("keeps toolset ids unique", () => {
    expect(new Set(TOOLSETS.map((toolset) => toolset.id)).size).toBe(TOOLSETS.length);
  });
});

describe("ToolRegistry", () => {
  it("resolves a toolset in order", () => {
    const registry = new ToolRegistry(buildTools());
    expect(registry.resolveToolset(MODELING_TOOLSET).map((tool) => tool.name)).toEqual([...MODELING_TOOLSET.toolNames]);
  });

  it("refuses to start when a catalog tool is not implemented", () => {
    const withoutCheck = buildTools().filter((tool) => tool.name !== TOOL_NAMES.validationCheckScene);
    expect(() => new ToolRegistry(withoutCheck)).toThrow(/without a registration: validation\.check_scene/);
  });

  it("refuses to start when a tool is missing from the catalog", () => {
    const extra = defineTool({ name: "extra.tool", description: "x", permission: "read", parameters: z.object({}), execute: () => ({}) });
    expect(() => new ToolRegistry([...buildTools(), extra])).toThrow(/missing from the catalog: extra\.tool/);
  });

  it("refuses duplicate registrations", () => {
    const tools = buildTools();
    const first = tools[0];
    if (!first) throw new Error("no tools");
    expect(() => new ToolRegistry([...tools, first])).toThrow(/Duplicate tool/);
  });

  it("describes tools as serialisable JSON without handlers", () => {
    const descriptors = new ToolRegistry(buildTools()).describe();
    expect(descriptors).toHaveLength(ALL_TOOL_NAMES.length);
    for (const descriptor of descriptors) {
      expect(JSON.parse(JSON.stringify(descriptor))).toEqual(descriptor);
      expect(descriptor.providerName).toBe(toProviderToolName(descriptor.name));
    }
  });
});

describe("tools as sent to model providers", () => {
  const tools = buildTools();

  it.each(tools.map((tool) => [tool.name, tool] as const))("%s is a strict, documented, provider-safe tool", (_name, definition) => {
    const sdkTool = toSdkTool(definition);
    expect(sdkTool.strict).toBe(true);
    expect(sdkTool.name).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
    expect(sdkTool.description.length).toBeGreaterThanOrEqual(60);
    expect(sdkTool.description.length).toBeLessThanOrEqual(1000);
    expect(strictProblems(sdkTool.parameters)).toEqual([]);
  });

  it.each(tools.map((tool) => [tool.name, tool] as const))("%s documents every argument", (_name, definition) => {
    const properties = describeTool(definition).inputSchema["properties"];
    const entries = typeof properties === "object" && properties !== null ? Object.entries(properties) : [];
    for (const [key, schema] of entries) {
      expect({ key, described: typeof schema === "object" && schema !== null && "description" in schema }).toEqual({
        key,
        described: true,
      });
    }
  });
});

describe("tool execution through the SDK adapter", () => {
  const byName = (name: string) => {
    const definition = buildTools().find((tool) => tool.name === name);
    if (!definition) throw new Error(`no tool ${name}`);
    return toSdkTool(definition);
  };

  it("accepts the nulls a strict-mode model sends for omitted optional fields", async () => {
    const output = await byName(TOOL_NAMES.editorProposeCommands).invoke(
      runContext(),
      JSON.stringify({
        summary: "Add torso",
        commands: [{ commandId: "c1", type: "scene.create_object", objectId: "torso", name: "Torso", parentId: null, transform: null }],
      }),
    );
    expect(JSON.parse(String(output))).toMatchObject({ proposalId: "prp_1", status: "proposed" });
    expect(proposeInputs).toEqual([{ summary: "Add torso", commands: [{ commandId: "c1", type: "scene.create_object", objectId: "torso", name: "Torso" }] }]);
  });

  it("returns a structured, recoverable error for invalid arguments", async () => {
    const output = await byName(TOOL_NAMES.editorApplyProposal).invoke(runContext(), JSON.stringify({ proposalId: "not valid!" }));
    expect(JSON.parse(String(output))).toMatchObject({
      error: expect.stringContaining("did not match"),
      hint: expect.stringContaining("call the tool again"),
    });
    expect(proposeInputs).toEqual([]);
  });

  it("returns the failure, not a stack trace, when a handler throws", async () => {
    const failing = toSdkTool(
      defineTool({
        name: "sample.boom",
        description: "A tool that always fails with a secret in its message",
        permission: "read",
        parameters: z.object({}).strict(),
        execute: () => {
          throw new Error("secret path /etc/passwd");
        },
      }),
    );
    const output = String(await failing.invoke(runContext(), "{}"));
    expect(output).not.toContain("secret");
    expect(JSON.parse(output)).toMatchObject({ error: "Tool execution failed" });
    expect(emitted.map((event) => event.type)).toEqual(["tool.started", "tool.failed"]);
  });

  it("passes domain error details, such as conflicting commands, to the model", async () => {
    const conflicting = toSdkTool(
      defineTool({
        name: "sample.conflict",
        description: "A tool that fails with a domain error that has details",
        permission: "read",
        parameters: z.object({}).strict(),
        execute: () => {
          throw new ValidationFailedError("Proposal conflicts with the current scene", {
            issues: [{ commandId: "c2", message: "objectId already exists" }],
          });
        },
      }),
    );
    const failure = JSON.parse(String(await conflicting.invoke(runContext(), "{}")));
    expect(failure).toMatchObject({
      error: "Proposal conflicts with the current scene",
      details: { issues: [{ commandId: "c2", message: "objectId already exists" }] },
    });
  });

  it("replaces oversized results with a short error", async () => {
    const huge = toSdkTool(
      defineTool({
        name: "sample.huge",
        description: "A tool that returns far too much data",
        permission: "read",
        parameters: z.object({}).strict(),
        execute: () => ({ data: "x".repeat(MAX_TOOL_OUTPUT_CHARS) }),
      }),
    );
    const output = String(await huge.invoke(runContext(), "{}"));
    expect(output.length).toBeLessThan(500);
    expect(JSON.parse(output)).toMatchObject({ error: expect.stringContaining("too large") });
  });

  it("accepts provider-style tool names in a plan and rejects unknown ones", async () => {
    const plan = byName(TOOL_NAMES.modelingGeneratePlan);
    const step = (toolName: string) => ({ id: "s1", title: "Step", toolName, description: "d", requiresApproval: false });
    const context = runContext();
    const accepted = await plan.invoke(context, JSON.stringify({ goal: "g", dimension: "3d", steps: [step("editor__propose_commands")] }));
    expect(JSON.parse(String(accepted))).toMatchObject({ status: "recorded", stepCount: 1 });
    expect(context.context.plans[0]?.steps[0]?.toolName).toBe("editor.propose_commands");

    const rejected = await plan.invoke(context, JSON.stringify({ goal: "g", dimension: "3d", steps: [step("shell.exec")] }));
    expect(JSON.parse(String(rejected))).toMatchObject({ status: "rejected", unknownTools: ["shell.exec"] });
  });
});
