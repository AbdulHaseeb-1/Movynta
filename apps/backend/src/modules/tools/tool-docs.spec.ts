import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  editorCommandListSchema,
  editorContextSchema,
  materialSlotSchema,
  measurementResultSchema,
  meshInspectionSchema,
  type EditorContext,
  type MeasurementRequest,
} from "@movynta/editor-protocol";
import type { AgentRunContext } from "../agent-runs/agent-runs.types.js";
import type { EditorBridge } from "../editor-bridge/editor-bridge.types.js";
import type { CommandProposalService } from "../editor-bridge/proposals/command-proposal.service.js";
import { validateAgainstContext } from "../editor-bridge/proposals/command-proposal.service.js";
import { parseSkillDocument } from "../skills/skill-document.parser.js";
import type { SkillsRegistry } from "../skills/skills.registry.js";
import { createEditorTools } from "./editor/editor.tools.js";
import { createModelingTools, MODELING_PLAN_TOOL_NAME } from "./modeling/modeling.tools.js";
import { createProceduralTools } from "./procedural/procedural.tools.js";
import { createSkillTools } from "./skills/skills.tools.js";
import { createValidationTools } from "./validation/validation.tools.js";
import { createViewportTools } from "./viewport/viewport.tools.js";
import type { ToolDefinition } from "./tool.types.js";
import { emptyRunProgress } from "../agent-runs/run-progress.js";

/*
 * Keeps the assistant tool reference honest. The reference (shown in the app's Documentation page, and generated into
 * docs/tools) holds one example request and result per tool.
 * Tools marked "code" are run here with the same sample scene and their results are compared with the example.
 * Tools marked "live" need the desktop editor, so only their request and the shape of their result are checked.
 * Jest runs from apps/backend, so the repository root is two levels up.
 */
const repoRoot = resolve(process.cwd(), "..", "..");
const dataPath = resolve(repoRoot, "apps/desktop/src/features/documentation/assistantTools/assistantTools.json");
const docsDir = resolve(repoRoot, "docs/tools");

interface DemoEntry {
  readonly name: string;
  readonly type: string;
  readonly verify: "code" | "live";
  readonly doc: string;
  readonly request: unknown;
  readonly response: unknown;
}

interface DemoData {
  readonly scene: unknown;
  readonly tools: readonly DemoEntry[];
}

function loadDemoData(): DemoData {
  return JSON.parse(readFileSync(dataPath, "utf8")) as DemoData;
}

/** The demo page writes "$scene" where the result is the whole scene. */
function expectedResult(demo: DemoEntry, scene: unknown): unknown {
  return demo.response === "$scene" ? scene : demo.response;
}

/** Replaces the random ids that duplication generates, so the example's fixed ids still compare. */
function normalize(value: unknown): unknown {
  if (typeof value === "string") return /^obj_[0-9a-f-]{36}$/.test(value) ? "obj_<id>" : value;
  if (Array.isArray(value)) return value.map(normalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalize(item)]));
  }
  return value;
}

/** Round-trips through JSON, the same form the result takes when it reaches the model. */
function asJson(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value ?? null));
}

const IDENTITY_MATRIX = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** A bridge that answers from the sample scene. Dimensions come from each object's world bounds. */
function stubBridge(scene: EditorContext): EditorBridge {
  return {
    assertConnection: () => undefined,
    getContext: async (_clientId: string, _inspection?: unknown, request?: MeasurementRequest) => {
      if (request?.kind !== "dimensions") return scene;
      const object = scene.objects.find((item) => item.id === request.target.objectId);
      if (!object?.worldBounds) return { ...scene, measurement: { status: "unavailable", message: "No geometry" } };
      const { min, max } = object.worldBounds;
      const center = min.map((value, index) => (value + (max[index] ?? value)) / 2);
      const size = max.map((value, index) => value - (min[index] ?? value));
      const measurement = measurementResultSchema.parse({
        status: "ok",
        data: { kind: "dimensions", space: "world", bounds: { min, max }, size, center, parentWorldInverse: IDENTITY_MATRIX },
      });
      return { ...scene, measurement };
    },
  } as unknown as EditorBridge;
}

/** Stores nothing. It returns the id the example names, so the result can be compared. */
function stubProposals(state: { nextId: string; revision: number }): CommandProposalService {
  return {
    propose: async (_run: unknown, input: { summary: string; commands: unknown }) => ({
      id: state.nextId,
      status: "proposed",
      requiresApproval: false,
      commands: editorCommandListSchema.parse(input.commands),
      baseRevision: state.revision,
      summary: input.summary,
    }),
  } as unknown as CommandProposalService;
}

function runContext(scene: EditorContext): AgentRunContext {
  return {
    runId: "run_demo",
    userId: "user_demo",
    projectId: scene.projectId,
    sessionId: "session_demo",
    clientId: "client_demo",
    dimension: "3d",
    selectedSkillIds: ["mesh-editing"],
    events: { emit: () => undefined },
    signal: new AbortController().signal,
    progress: emptyRunProgress(),
    supportsToolImages: false,
  } as unknown as AgentRunContext;
}

function buildTools(scene: EditorContext, state: { nextId: string; revision: number }) {
  const bridge = stubBridge(scene);
  const proposals = stubProposals(state);
  const skills = parseAndRegisterSkill();
  const editorTools = createEditorTools({ bridge, proposals, getUnits: () => null });
  const validationTools = createValidationTools({ bridge });
  const skillTools = createSkillTools({ skills });
  const proceduralTools = createProceduralTools({ bridge, proposals });
  const viewportTools = createViewportTools({ bridge, proposals });
  const knownToolNames = [...editorTools, ...validationTools, ...skillTools, ...proceduralTools, ...viewportTools].map((tool) => tool.name);
  const modelingTools = createModelingTools({ knownToolNames: [...knownToolNames, MODELING_PLAN_TOOL_NAME] });
  return [...editorTools, ...validationTools, ...skillTools, ...proceduralTools, ...viewportTools, ...modelingTools];
}

/** The real manifest of the skill the example loads, so its tool list and checks are compared with the file. */
function parseAndRegisterSkill(): SkillsRegistry {
  const source = readFileSync(resolve(repoRoot, "skills/mesh-editing/SKILL.md"), "utf8");
  const manifest = parseSkillDocument(source, "mesh-editing");
  return { get: (id: string) => (id === manifest.id ? manifest : undefined) } as unknown as SkillsRegistry;
}

const data = loadDemoData();
const scene = editorContextSchema.parse(data.scene);
const demos = data.tools;

describe("tool documentation examples", () => {
  const state = { nextId: "", revision: scene.revision };
  const tools = buildTools(scene, state);
  const byName = new Map<string, ToolDefinition>(tools.map((tool) => [tool.name, tool]));

  it("has one example for every registered tool, and no others", () => {
    expect(demos.map((demo) => demo.name).sort()).toEqual(tools.map((tool) => tool.name).sort());
  });

  it("has a reference document for every tool, and an index", () => {
    expect(existsSync(resolve(docsDir, "README.md"))).toBe(true);
    for (const demo of demos) {
      expect(demo.doc).toBe(`${demo.name}.md`);
      expect(existsSync(resolve(docsDir, demo.doc))).toBe(true);
    }
  });

  for (const demo of demos) {
    it(`${demo.name}: the example request is accepted by the tool's schema`, () => {
      const definition = byName.get(demo.name);
      expect(definition).toBeDefined();
      expect(definition?.parameters.safeParse(demo.request).success).toBe(true);
    });

    if (demo.verify === "code") {
      it(`${demo.name}: the example result is what the code returns`, async () => {
        const definition = byName.get(demo.name);
        if (!definition) throw new Error(`No tool ${demo.name}`);
        state.nextId = typeof (demo.response as { proposalId?: unknown }).proposalId === "string"
          ? (demo.response as { proposalId: string }).proposalId
          : "";
        const result = await definition.execute(demo.request, runContext(scene));
        const actual = demo.name === "skills.load_skill" ? pickSkillFields(result) : result;
        const expected = demo.name === "skills.load_skill" ? pickSkillFields(expectedResult(demo, data.scene)) : expectedResult(demo, data.scene);
        expect(normalize(asJson(actual))).toEqual(normalize(asJson(expected)));
      });
    }
  }

  it("the example scene is a valid editor snapshot", () => {
    expect(scene.objects).toHaveLength(6);
    expect(scene.revision).toBe(12);
  });

  it("the example proposal could be applied to the example scene", () => {
    const propose = demos.find((demo) => demo.name === "editor.propose_commands");
    const request = propose?.request as { commands: unknown };
    expect(validateAgainstContext(editorCommandListSchema.parse(request.commands), scene)).toEqual([]);
  });

  it("the example mesh inspection, measurement and material match the protocol schemas", () => {
    const inspect = demos.find((demo) => demo.name === "editor.inspect_mesh")?.response as { inspection: unknown };
    expect(meshInspectionSchema.safeParse(inspect.inspection).success).toBe(true);
    const measure = demos.find((demo) => demo.name === "editor.measure")?.response as { result: unknown };
    expect(measurementResultSchema.safeParse(measure.result).success).toBe(true);
    const materials = demos.find((demo) => demo.name === "editor.inspect_materials")?.response as { materials: unknown[] };
    for (const material of materials.materials) expect(materialSlotSchema.safeParse(material).success).toBe(true);
  });
});

/** The fields of a skill result that come from the skill file. The instructions are shortened in the example. */
function pickSkillFields(value: unknown) {
  const source = value as Record<string, unknown>;
  return { status: source["status"], skillId: source["skillId"], version: source["version"], toolNames: source["toolNames"], validation: source["validation"], errorHandling: source["errorHandling"] };
}
