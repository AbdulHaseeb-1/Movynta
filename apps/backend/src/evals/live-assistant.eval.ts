import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { TERMINAL_RUN_STATUSES } from "../modules/agent-runs/agent-run.state-machine.js";
import { ProvidersService } from "../modules/providers/providers.service.js";
import type { SecretProtector } from "../modules/providers/secret-protector.js";
import type { EditorObject } from "../shared/types/editor-context.types.js";
import { EditorSimulator } from "../testing/editor-simulator.js";
import { openEventStream } from "../testing/event-stream.js";
import { startTestServer } from "../testing/test-app.js";
import type { EditorCommand, TestServer } from "../testing/testing.types.js";

/**
 * A live check of the assistant with a real model. This file is not part of `pnpm test`: it calls the model, so it
 * needs RESPAN_API_KEY and spends tokens. Run it with `pnpm --filter movynta-backend eval:live`.
 *
 * The server, agent, tools and command validation are the real ones, and the model is reached through the same
 * `openai-compatible` provider a user would configure. Only the editor is simulated, so grading looks at what the
 * model chose to do (commands, parents, names), not at the resulting geometry. The report is written even when a
 * check fails. Set LIVE_EVAL_REPORT to choose where it goes.
 */

const PROVIDER_ID = "openai-compatible";
const MODEL = "claude-haiku-5-5";
const BASE_URL = "https://api.respan.ai/api";
const REPEATS = 2;
const RUN_TIMEOUT_MS = 240_000;
const TERMINAL: readonly string[] = TERMINAL_RUN_STATUSES;
const USER_ID = "live-eval";

interface Check {
  readonly name: string;
  readonly pass: boolean;
  readonly detail: string;
}
interface RunOutcome {
  readonly status: string;
  readonly error: string;
  readonly finalOutput: string;
  readonly approvals: readonly string[];
  /** Skills the request selected, as the run reported them when it started. */
  readonly skillsSelected: readonly string[];
  /** Skills the model read with skills.load_skill. */
  readonly skillsLoaded: readonly string[];
  readonly proposals: readonly (readonly EditorCommand[])[];
  readonly objects: readonly EditorObject[];
}
interface Scenario {
  readonly id: string;
  readonly message: string;
  readonly scene: readonly EditorObject[];
  readonly grade: (outcome: RunOutcome) => readonly Check[];
}

const runSchema = z.object({
  status: z.string(),
  finalOutput: z.string().nullish(),
  error: z.object({ message: z.string() }).nullish(),
});
const acceptedSchema = z.object({ runId: z.string(), eventsUrl: z.string() });
const TERMINAL_EVENTS: readonly string[] = ["run.completed", "run.failed", "run.cancelled"];
const skillIdPayload = z.object({ skillId: z.string() });
const approvalsSchema = z.array(z.object({ id: z.string(), status: z.string(), toolName: z.string() }));
const vec3 = z.tuple([z.number(), z.number(), z.number()]);

function mesh(id: string, name: string, parentId: string | null, position: [number, number, number]): EditorObject {
  return {
    id,
    name,
    type: "mesh",
    parentId,
    transform: { position, rotation: [0, 0, 0], scale: [1, 1, 1] },
  };
}

function check(name: string, pass: boolean, detail = ""): Check {
  return { name, pass, detail };
}

/** Reads a command's fields without assuming which command it is. */
function fieldsOf(command: EditorCommand): Readonly<Record<string, unknown>> {
  return { ...command };
}

function near(actual: unknown, expected: readonly number[]): boolean {
  const parsed = vec3.safeParse(actual);
  return parsed.success && parsed.data.every((value, index) => Math.abs(value - (expected[index] ?? NaN)) < 1e-6);
}

/** Whether `object` reaches `ancestorId` by walking parents. */
function under(object: EditorObject, ancestorId: string, objects: readonly EditorObject[]): boolean {
  let parentId = object.parentId;
  for (let depth = 0; depth < 32 && parentId !== null; depth += 1) {
    if (parentId === ancestorId) return true;
    const parent: string = parentId;
    parentId = objects.find((candidate) => candidate.id === parent)?.parentId ?? null;
  }
  return false;
}

const PRIMITIVE_NAMES = ["box", "sphere", "cylinder", "cube", "mesh"];

const figure: Scenario = {
  id: "figure",
  message:
    "Build a simple standing figure out of primitives: a box torso, a sphere head on top of it, and two cylinder arms attached to the torso. Put every part under one parent called Figure, and give each part its own descriptive name.",
  scene: [],
  grade({ objects, approvals, ...outcome }) {
    const root = objects.find((object) => object.name === "Figure");
    const parts = objects.filter((object) => object.id !== root?.id);
    const torso = parts.find((part) => part.name.toLowerCase().includes("torso"));
    const arms = parts.filter((part) => part.name.toLowerCase().includes("arm"));
    const siblingKeys = parts.map((object) => `${object.parentId ?? ""}\u0000${object.name}`);
    const duplicateSiblings = siblingKeys.filter((key, index) => siblingKeys.indexOf(key) !== index);
    return [
      check("has a parent named Figure", root !== undefined, objects.map((object) => object.name).join(", ")),
      check("at least four parts", parts.length >= 4, `${parts.length} parts`),
      check(
        "every part is under Figure",
        root !== undefined && parts.every((part) => under(part, root.id, objects)),
        parts.filter((part) => root === undefined || !under(part, root.id, objects)).map((part) => part.name).join(", "),
      ),
      check(
        "parts have descriptive names",
        parts.every((part) => !PRIMITIVE_NAMES.includes(part.name.toLowerCase())),
        parts.map((part) => part.name).join(", "),
      ),
      check("siblings have distinct names", duplicateSiblings.length === 0, duplicateSiblings.join(", ")),
      check(
        "both arms are attached to Torso",
        torso !== undefined && arms.length === 2 && arms.every((arm) => arm.parentId === torso.id),
        arms.map((arm) => `${arm.name} under ${arm.parentId ?? "nothing"}`).join(", "),
      ),
      check(
        "names cover torso, head and arms",
        ["torso", "head", "arm"].every((word) => parts.some((part) => part.name.toLowerCase().includes(word))),
        parts.map((part) => part.name).join(", "),
      ),
      check("needs no approval", approvals.length === 0, approvals.join(", ")),
      check(
        "character-modeling skill was selected for the request",
        outcome.skillsSelected.includes("character-modeling"),
        outcome.skillsSelected.join(", ") || "none",
      ),
    ];
  },
};

const headUp: Scenario = {
  id: "relative-move",
  message: "Move the Head up by 0.5 units. Keep it under Torso and do not change anything else.",
  scene: [mesh("torso", "Torso", null, [0, 0, 0]), mesh("head", "Head", "torso", [0, 1.6, 0])],
  grade({ objects, proposals }) {
    const commands = proposals.flat();
    const head = objects.find((object) => object.id === "head");
    const moves = commands.filter((command) => command.type === "scene.move_object" && command.objectId === "head");
    const sets = commands.filter((command) => command.type === "scene.transform_object" && command.objectId === "head");
    const relativeOk = moves.some((command) => near(fieldsOf(command)["delta"], [0, 0.5, 0]));
    const absoluteOk = sets.some((command) => {
      const transform = z.object({ position: vec3 }).safeParse(fieldsOf(command)["transform"]);
      return transform.success && near(transform.data.position, [0, 2.1, 0]);
    });
    return [
      check("Head stays under Torso", head?.parentId === "torso", `parent ${String(head?.parentId)}`),
      check(
        "Head moves up by 0.5",
        relativeOk || absoluteOk,
        relativeOk ? "scene.move_object delta" : absoluteOk ? "scene.transform_object to y=2.1" : "no matching command",
      ),
      check("uses the relative move command", relativeOk, moves.length > 0 ? "move_object used" : "move_object not used"),
      check(
        "touches nothing else",
        commands.every((command) => "objectId" in command && command.objectId === "head"),
        commands.map((command) => `${command.type}:${"objectId" in command ? command.objectId : ""}`).join(", "),
      ),
    ];
  },
};

const deleteTree: Scenario = {
  id: "delete-with-children",
  message: "Delete the Torso and everything under it.",
  scene: [
    mesh("torso", "Torso", null, [0, 0, 0]),
    mesh("head", "Head", "torso", [0, 1.6, 0]),
    mesh("armL", "Arm L", "torso", [-0.8, 1, 0]),
  ],
  grade({ objects, proposals }) {
    const commands = proposals.flat();
    const deletes = commands.flatMap((command, index) => (command.type === "scene.delete_object" ? [{ id: command.objectId, index }] : []));
    const torsoAt = deletes.find((entry) => entry.id === "torso")?.index ?? -1;
    const childrenFirst = ["head", "armL"].every((id) => {
      const at = deletes.find((entry) => entry.id === id)?.index ?? -1;
      return at >= 0 && at < torsoAt;
    });
    return [
      check("Torso is gone", !objects.some((object) => object.id === "torso")),
      check("Head is gone", !objects.some((object) => object.id === "head")),
      check("Arm L is gone", !objects.some((object) => object.id === "armL")),
      check("children are deleted before Torso", childrenFirst, deletes.map((entry) => entry.id).join(", ")),
    ];
  },
};

const SCENARIOS: readonly Scenario[] = [figure, headUp, deleteTree];

/** Talks to the running server as the eval user. */
async function call<Schema extends z.ZodType>(
  server: TestServer,
  token: string,
  method: string,
  path: string,
  schema: Schema,
  body?: unknown,
): Promise<z.infer<Schema>> {
  const response = await fetch(server.baseUrl + path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  const json: unknown = text.length > 0 ? JSON.parse(text) : undefined;
  if (!response.ok) throw new Error(`${method} ${path} returned ${response.status}: ${text.slice(0, 300)}`);
  return schema.parse(json);
}

async function runOnce(server: TestServer, token: string, scenario: Scenario, repeat: number): Promise<RunOutcome> {
  const projectId = `live-${scenario.id}-${repeat}-${Date.now().toString(36)}`;
  const editor = await EditorSimulator.connect(server.wsUrl, token, projectId, scenario.scene);
  try {
    const accepted = await call(server, token, "POST", "/api/v1/agent-runs", acceptedSchema, {
      projectId,
      editorClientId: editor.clientId,
      message: scenario.message,
      dimension: "3d",
      providerId: PROVIDER_ID,
      model: MODEL,
    });
    // The stream replays from the start, so it holds the skills selected at run.started and every skill.loaded.
    const stream = openEventStream(server.baseUrl + accepted.eventsUrl, token);
    const approvalsSeen = new Set<string>();
    const approvals: string[] = [];
    const deadline = Date.now() + RUN_TIMEOUT_MS;
    let run = await call(server, token, "GET", `/api/v1/agent-runs/${accepted.runId}`, runSchema);
    while (!TERMINAL.includes(run.status) && Date.now() < deadline) {
      const pending = await call(server, token, "GET", `/api/v1/agent-runs/${accepted.runId}/approvals`, approvalsSchema);
      for (const approval of pending) {
        if (approval.status !== "pending" || approvalsSeen.has(approval.id)) continue;
        approvalsSeen.add(approval.id);
        approvals.push(approval.toolName);
        await call(server, token, "POST", `/api/v1/agent-runs/${accepted.runId}/approvals/${approval.id}`, z.unknown(), { decision: "approve" });
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
      run = await call(server, token, "GET", `/api/v1/agent-runs/${accepted.runId}`, runSchema);
    }
    await stream.waitFor((event) => TERMINAL_EVENTS.includes(event.envelope.type), 30_000).catch(() => undefined);
    stream.stop();
    const started = stream.events.find((event) => event.envelope.type === "run.started");
    const selected = z.array(z.string()).safeParse(started?.envelope.payload["selectedSkillIds"]);
    const skillsLoaded = stream.events.flatMap((event) => {
      const parsed = skillIdPayload.safeParse(event.envelope.payload);
      return event.envelope.type === "skill.loaded" && parsed.success ? [parsed.data.skillId] : [];
    });
    return {
      status: TERMINAL.includes(run.status) ? run.status : `timed out (${run.status})`,
      error: run.error?.message ?? "",
      finalOutput: (run.finalOutput ?? "").slice(0, 600),
      approvals,
      skillsSelected: selected.success ? selected.data : [],
      skillsLoaded,
      proposals: editor.executions.map((execution) => execution.commands),
      objects: editor.scene.objects,
    };
  } finally {
    editor.close();
  }
}

describe("live assistant evaluation (Haiku via respan)", () => {
  let server: TestServer;
  let token: string;
  const results: { scenario: string; repeat: number; outcome: RunOutcome; checks: readonly Check[] }[] = [];

  beforeAll(async () => {
    const apiKey = process.env["RESPAN_API_KEY"];
    if (!apiKey) throw new Error("Set RESPAN_API_KEY to run the live evaluation");
    process.env["OPENAI_AGENTS_DISABLE_TRACING"] = "true";
    // The database is in memory and dies with this process, so the key is kept in memory only, never on disk.
    const memoryVault: SecretProtector = { protect: (value) => Promise.resolve(value), unprotect: (value) => Promise.resolve(value) };
    server = await startTestServer(0, { runTimeoutMs: RUN_TIMEOUT_MS, secretProtector: memoryVault });
    token = server.token(USER_ID);
    await server.app.get(ProvidersService).save(USER_ID, PROVIDER_ID, MODEL, apiKey, BASE_URL);
  }, 60_000);

  afterAll(async () => {
    await server?.close();
    const report = {
      model: MODEL,
      endpoint: BASE_URL,
      generatedAt: new Date().toISOString(),
      results,
    };
    const path = process.env["LIVE_EVAL_REPORT"] ?? join(process.cwd(), ".test-output", "live-assistant-eval.json");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
    const passed = results.filter((result) => result.checks.every((item) => item.pass)).length;
    console.log(`live eval: ${passed}/${results.length} runs passed all checks; report at ${path}`);
  });

  for (const scenario of SCENARIOS) {
    for (let repeat = 1; repeat <= REPEATS; repeat += 1) {
      it(`${scenario.id} (run ${repeat})`, async () => {
        const outcome = await runOnce(server, token, scenario, repeat);
        const checks = [check("run completed", outcome.status === "completed", outcome.error || outcome.status), ...scenario.grade(outcome)];
        results.push({ scenario: scenario.id, repeat, outcome, checks });
        const failed = checks.filter((item) => !item.pass);
        expect(failed.map((item) => `${item.name}: ${item.detail}`)).toEqual([]);
      }, RUN_TIMEOUT_MS + 60_000);
    }
  }
});
