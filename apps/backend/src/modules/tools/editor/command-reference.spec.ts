import { CAGE_EDIT_COMMAND_TYPES, editorCommandSchema, MODIFIER_COMMAND_TYPES, TOPOLOGY_EDIT_COMMAND_TYPES } from "@movynta/editor-protocol";
import type { AgentRunContext } from "../../agent-runs/agent-runs.types.js";
import { COMMAND_REFERENCE, COMMAND_TYPES, isCommandType } from "./command-reference.js";
import { createEditorTools } from "./editor.tools.js";

/** The command types the protocol accepts, read from the schema itself rather than from the reference. */
const protocolTypes = editorCommandSchema.options.map((option) => option.shape.type.value).sort();

const tools = new Map(createEditorTools({ bridge: {} as never, proposals: {} as never }).map((tool) => [tool.name, tool]));
function tool(name: string) {
  const found = tools.get(name);
  if (!found) throw new Error(`Missing ${name}`);
  return found;
}
const context = {} as AgentRunContext;

/** What editor.propose_commands may cost in characters on every model call; it was 22,000 before the reference. */
const DESCRIPTION_BUDGET = 10_500;

describe("the command reference", () => {
  it("has an entry for every command the protocol accepts, and no others", () => {
    expect([...COMMAND_TYPES].sort()).toEqual(protocolTypes);
    for (const type of COMMAND_TYPES) {
      expect(COMMAND_REFERENCE[type].summary.length).toBeGreaterThan(10);
      expect(COMMAND_REFERENCE[type].summary.length).toBeLessThanOrEqual(200);
      expect(COMMAND_REFERENCE[type].rules.length).toBeGreaterThan(10);
    }
  });

  it("does not take inherited names for command types", () => {
    expect(isCommandType("geometry.bisect")).toBe(true);
    expect(isCommandType("constructor")).toBe(false);
    expect(isCommandType("toString")).toBe(false);
  });
});

describe("editor.propose_commands description", () => {
  const description = tool("editor.propose_commands").description;

  it("lists every command in one line and states the batching rules the validator enforces", () => {
    for (const type of COMMAND_TYPES) expect(description).toContain(`- ${type}: ${COMMAND_REFERENCE[type].summary}`);
    for (const type of [...CAGE_EDIT_COMMAND_TYPES, ...TOPOLOGY_EDIT_COMMAND_TYPES, ...MODIFIER_COMMAND_TYPES]) expect(description).toContain(type);
    expect(description).toContain("editor.describe_commands");
  });

  it(`stays within ${DESCRIPTION_BUDGET} characters, since the model reads it on every call`, () => {
    expect(description.length).toBeLessThanOrEqual(DESCRIPTION_BUDGET);
  });
});

describe("editor.describe_commands", () => {
  it("returns the full rules of the commands asked for, once each", async () => {
    const result = await tool("editor.describe_commands").execute({ types: ["geometry.bisect", "material.assign", "geometry.bisect"] }, context);
    expect(result).toEqual({
      commands: [
        { type: "geometry.bisect", summary: COMMAND_REFERENCE["geometry.bisect"].summary, rules: COMMAND_REFERENCE["geometry.bisect"].rules },
        { type: "material.assign", summary: COMMAND_REFERENCE["material.assign"].summary, rules: COMMAND_REFERENCE["material.assign"].rules },
      ],
      unknown: [],
    });
  });

  it("suggests the closest command for a type that does not exist", async () => {
    const result = await tool("editor.describe_commands").execute({ types: ["geometry.extrude_faces", "constructor"] }, context) as { commands: unknown[]; unknown: { type: string; closest: string[] }[] };
    expect(result.commands).toEqual([]);
    expect(result.unknown.map((entry) => entry.type)).toEqual(["geometry.extrude_faces", "constructor"]);
    expect(result.unknown[0]?.closest[0]).toBe("geometry.extrude");
  });
});
