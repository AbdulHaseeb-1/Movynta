import { randomUUID } from "node:crypto";
import { assistantMessage } from "@openai/agents/testing";
import { startTestServer } from "../../testing/test-app.js";
import type { TestServer } from "../../testing/testing.types.js";
import type { EditorCommand } from "../../shared/types/editor-command.types.js";
import { DatabaseService } from "../persistence/database.service.js";
import { ProjectScenesService } from "./project-scenes.service.js";
import { normalizeProjectName } from "./projects.service.js";
import type { ProjectView } from "./projects.types.js";

let server: TestServer;
beforeAll(async () => {
  server = await startTestServer();
}, 60000);
afterAll(async () => {
  await server.close();
});

async function request(path: string, method = "GET", body?: unknown, user = "project-user") {
  return fetch(`${server.baseUrl}/api/v1${path}`, {
    method,
    headers: { Authorization: `Bearer ${server.token(user)}`, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function create(body: unknown = {}, user = "project-user"): Promise<ProjectView> {
  const response = await request("/projects", "POST", body, user);
  expect(response.status).toBe(201);
  return (await response.json()) as ProjectView;
}
async function list(query = "", user = "project-user"): Promise<ProjectView[]> {
  return (await (await request(`/projects${query}`, "GET", undefined, user)).json()) as ProjectView[];
}
const box = (commandId: string, objectId: string): EditorCommand => ({
  type: "geometry.create_primitive",
  commandId,
  objectId,
  primitive: "box",
  size: 1,
  replaceExisting: false,
});
/** Inserts a run the way the run service would, so listings have prompts to show. */
function insertRun(projectId: string, input: string, status = "completed", user = "project-user") {
  const db = server.app.get(DatabaseService).db;
  const sessionId = randomUUID();
  const now = new Date().toISOString();
  db.prepare("INSERT INTO sessions (id, user_id, project_id, created_at) VALUES (?, ?, ?, ?)").run(sessionId, user, projectId, now);
  db.prepare(
    "INSERT INTO agent_runs (id, session_id, user_id, project_id, agent_id, status, input, final_output, created_at, updated_at) VALUES (?, ?, ?, ?, 'modeling-coordinator', ?, ?, 'Done.', ?, ?)",
  ).run(`run_${randomUUID()}`, sessionId, user, projectId, status, input, now, now);
  return sessionId;
}

describe("project names", () => {
  it("tidies whitespace and control characters, and limits the length", () => {
    expect(normalizeProjectName("  Robot \n\t  head  ")).toBe("Robot head");
    expect(normalizeProjectName("   ")).toBe("");
    expect(() => normalizeProjectName("x".repeat(81))).toThrow("limited to 80");
  });
});

describe("projects API", () => {
  it("creates an untitled design project by default", async () => {
    const project = await create();
    expect(project).toMatchObject({
      name: "",
      category: "design",
      starred: false,
      archived: false,
      runCount: 0,
      firstPrompt: "",
    });
    expect(project.id).toMatch(/^prj_/);
  });

  it("renames, stars and archives, and an empty name makes it untitled again", async () => {
    const project = await create({ name: " Pine  tree " });
    expect(project.name).toBe("Pine tree");
    const patch = async (body: unknown) => (await (await request(`/projects/${project.id}`, "PATCH", body)).json()) as ProjectView;
    expect(await patch({ starred: true })).toMatchObject({ starred: true, name: "Pine tree" });
    expect(await patch({ archived: true })).toMatchObject({ archived: true });
    expect(await patch({ archived: false })).toMatchObject({ archived: false });
    expect(await patch({ name: "  " })).toMatchObject({ name: "" });
  });

  it("rejects unknown fields, bad categories and over-long names", async () => {
    const project = await create();
    expect((await request(`/projects/${project.id}`, "PATCH", { owner: "me" })).status).toBe(400);
    expect((await request("/projects", "POST", { category: "audio" })).status).toBe(400);
    expect((await request(`/projects/${project.id}`, "PATCH", { name: "x".repeat(100) })).status).toBe(422);
    expect((await request("/projects/not-a-project")).status).toBe(400);
  });

  it("starring and archiving do not reorder recent projects, renaming does", async () => {
    const user = "ordering-user";
    const first = await create({}, user);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await create({}, user);
    expect((await list("", user)).map((item) => item.id)).toEqual([second.id, first.id]);
    await request(`/projects/${first.id}`, "PATCH", { starred: true }, user);
    expect((await list("", user)).map((item) => item.id)).toEqual([second.id, first.id]);
    await request(`/projects/${first.id}`, "PATCH", { name: "Renamed" }, user);
    expect((await list("", user)).map((item) => item.id)).toEqual([first.id, second.id]);
  });

  it("filters by search, scope and stars, and sorts by name with untitled last", async () => {
    const user = "listing-user";
    const zebra = await create({ name: "Zebra" }, user);
    const apple = await create({ name: "apple" }, user);
    const untitled = await create({}, user);
    insertRun(untitled.id, "A 100% wooden crate", "completed", user);
    await request(`/projects/${zebra.id}`, "PATCH", { starred: true, archived: true }, user);

    expect((await list("?sort=name", user)).map((item) => item.id)).toEqual([apple.id, untitled.id]);
    expect((await list("?scope=archived", user)).map((item) => item.id)).toEqual([zebra.id]);
    expect(await list("?scope=all", user)).toHaveLength(3);
    expect((await list("?scope=all&starred=true", user)).map((item) => item.id)).toEqual([zebra.id]);
    // Search matches names and the requests made in a project, and wildcards are literal.
    expect((await list("?search=CRATE", user)).map((item) => item.id)).toEqual([untitled.id]);
    expect((await list("?search=100%25", user)).map((item) => item.id)).toEqual([untitled.id]);
    expect(await list("?search=%25", user)).toHaveLength(1);
    expect(await list("?category=design&search=nothing-like-this", user)).toEqual([]);
    const [found] = await list("?search=crate", user);
    expect(found).toMatchObject({ runCount: 1, firstPrompt: "A 100% wooden crate" });
  });

  it("keeps projects private to their owner", async () => {
    const project = await create();
    for (const [path, method] of [
      [`/projects/${project.id}`, "GET"],
      [`/projects/${project.id}`, "PATCH"],
      [`/projects/${project.id}`, "DELETE"],
      [`/projects/${project.id}/duplicate`, "POST"],
      [`/projects/${project.id}/scene`, "GET"],
      [`/projects/${project.id}/conversation`, "GET"],
    ] as const) {
      expect((await request(path, method, method === "PATCH" ? { starred: true } : undefined, "intruder")).status).toBe(404);
    }
    expect(await list("", "intruder")).toEqual([]);
    // The owner's project id cannot be used to start runs from another account either.
    const run = await request("/agent-runs", "POST", { projectId: project.id, message: "hi" }, "intruder");
    expect(run.status).toBe(403);
  });

  it("restores the scene as the applied batches, in order, and duplicates it", async () => {
    const project = await create({ name: "Crates" });
    const scenes = server.app.get(ProjectScenesService);
    scenes.append(project.id, "prp_1", [box("a", "one")]);
    scenes.append(project.id, "prp_2", [box("b", "two")]);
    const scene = (await (await request(`/projects/${project.id}/scene`)).json()) as {
      steps: { kind: string; commands: { objectId: string }[] }[];
    };
    expect(scene.steps.map((step) => step.commands[0]?.objectId)).toEqual(["one", "two"]);

    const copy = (await (await request(`/projects/${project.id}/duplicate`, "POST")).json()) as ProjectView;
    expect(copy).toMatchObject({ name: "Crates copy", starred: false, runCount: 0 });
    expect(copy.id).not.toBe(project.id);
    const copied = (await (await request(`/projects/${copy.id}/scene`)).json()) as { steps: unknown[] };
    expect(copied.steps).toHaveLength(2);
    // Scenes of ids that are not stored projects are not recorded.
    expect(() => scenes.append("legacy-project", "prp_3", [box("c", "three")])).not.toThrow();
    expect(scenes.list("legacy-project")).toEqual([]);
  });

  it("returns the latest chat so the assistant can continue it", async () => {
    const project = await create();
    expect(await (await request(`/projects/${project.id}/conversation`)).json()).toEqual({ messages: [] });
    insertRun(project.id, "first idea");
    await new Promise((resolve) => setTimeout(resolve, 5));
    const latest = insertRun(project.id, "second idea", "failed");
    const conversation = (await (await request(`/projects/${project.id}/conversation`)).json()) as {
      sessionId: string;
      messages: { prompt: string; status: string }[];
    };
    expect(conversation.sessionId).toBe(latest);
    expect(conversation.messages).toMatchObject([{ prompt: "second idea", status: "failed" }]);
  });

  it("deletes a project with its chats and scene, but not while the assistant is working", async () => {
    const project = await create();
    const scenes = server.app.get(ProjectScenesService);
    scenes.append(project.id, "prp_1", [box("a", "one")]);
    insertRun(project.id, "build a crate", "running");
    const busy = await request(`/projects/${project.id}`, "DELETE");
    expect(busy.status).toBe(409);

    server.app.get(DatabaseService).db.prepare("UPDATE agent_runs SET status = 'cancelled' WHERE project_id = ?").run(project.id);
    expect((await request(`/projects/${project.id}`, "DELETE")).status).toBe(204);
    expect((await request(`/projects/${project.id}`)).status).toBe(404);
    const db = server.app.get(DatabaseService).db;
    for (const table of ["agent_runs", "sessions", "project_scene_batches", "project_assets"]) {
      expect(db.prepare(`SELECT 1 AS found FROM ${table} WHERE project_id = ?`).get(project.id)).toBeUndefined();
    }
  });

  it("lets a stored project be used by its owner for runs and moves it to the top", async () => {
    const user = "activity-user";
    const older = await create({ name: "Older" }, user);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await create({ name: "Newer" }, user);
    server.model.enqueue([assistantMessage("Done.")]);
    const accepted = await request("/agent-runs", "POST", { projectId: older.id, message: "A cube" }, user);
    expect(accepted.status).toBe(202);
    expect((await list("", user))[0]?.id).toBe(older.id);
  });
});

const GLB_HEADER = Buffer.concat([Buffer.from("glTF"), Buffer.alloc(24, 1)]);

describe("durable scene undo and redo", () => {
  it("groups multi-batch manual actions into one undo", async () => {
    const project = await create(); const scenes = server.app.get(ProjectScenesService);
    scenes.append(project.id, "first", [box("a", "a")], "gesture");
    scenes.append(project.id, "second", [box("b", "b")], "gesture");
    const preview = scenes.previewHistory(project.id, "undo");
    expect(preview.targets).toHaveLength(2); expect(preview.steps).toHaveLength(0);
    scenes.commitHistory(project.id, "undo", preview.version, "groupUndo");
    expect(scenes.list(project.id)).toHaveLength(0);
    const redo = scenes.previewHistory(project.id, "redo"); expect(redo.steps).toHaveLength(2);
  });
  it("previews without mutation, commits idempotently, and retains redo across reads", async () => {
    const project = await create(); const scenes = server.app.get(ProjectScenesService);
    scenes.append(project.id, "create", [box("c", "cube")]);
    scenes.append(project.id, "delete", [{ commandId: "d", type: "scene.delete_object", objectId: "cube" }]);
    const preview = scenes.previewHistory(project.id, "undo");
    expect(preview.steps).toHaveLength(1); expect(scenes.list(project.id)).toHaveLength(2);
    scenes.commitHistory(project.id, "undo", preview.version, "undo1");
    scenes.commitHistory(project.id, "undo", preview.version, "undo1");
    expect(scenes.list(project.id)).toHaveLength(1);
    expect(scenes.existingObjectIds(project.id, ["cube"]).has("cube")).toBe(true);
    const redo = scenes.previewHistory(project.id, "redo");
    scenes.commitHistory(project.id, "redo", redo.version, "redo1");
    expect(scenes.list(project.id)).toHaveLength(2);
    expect(scenes.existingObjectIds(project.id, ["cube"]).has("cube")).toBe(false);
    expect((await request(`/projects/${project.id}/scene/history/preview`, "POST", { direction: "undo" }, "intruder")).status).toBe(404);
  });

  it("rejects stale previews and abandons redo after a new edit", async () => {
    const project = await create(); const scenes = server.app.get(ProjectScenesService);
    scenes.append(project.id, "a", [box("a", "a")]);
    const preview = scenes.previewHistory(project.id, "undo");
    scenes.append(project.id, "b", [box("b", "b")]);
    expect(() => scenes.commitHistory(project.id, "undo", preview.version, "stale")).toThrow(/changed/);
    const fresh = scenes.previewHistory(project.id, "undo"); scenes.commitHistory(project.id, "undo", fresh.version, "fresh");
    scenes.append(project.id, "c", [box("c", "c")]);
    expect(scenes.history(project.id).canRedo).toBe(false); expect(scenes.list(project.id)).toHaveLength(2);
  });

  it("retains imported asset bytes while undoing and redoing the import", async () => {
    const project = await create(); const scenes = server.app.get(ProjectScenesService);
    const step = scenes.addImport(project.id, { objectId: "model", name: "Model", format: "glb", content: GLB_HEADER });
    const undo = scenes.previewHistory(project.id, "undo"); scenes.commitHistory(project.id, "undo", undo.version, "u");
    expect(scenes.list(project.id)).toEqual([]); expect(scenes.asset(project.id, step.assetId).content).toEqual(GLB_HEADER);
    const redo = scenes.previewHistory(project.id, "redo"); scenes.commitHistory(project.id, "redo", redo.version, "r");
    expect(scenes.list(project.id)).toEqual([step]);
  });
});

async function upload(
  projectId: string,
  content: Uint8Array | string,
  query: Record<string, string> = {},
  user = "project-user",
  contentType = "application/octet-stream",
) {
  const params = new URLSearchParams({ name: "robot.glb", format: "glb", objectId: "robot_glb", ...query });
  return fetch(`${server.baseUrl}/api/v1/projects/${projectId}/assets?${params.toString()}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${server.token(user)}`, "Content-Type": contentType },
    body: typeof content === "string" ? content : new Blob([Buffer.from(content)]),
  });
}

describe("imported models", () => {
  it("stores a model as a step between command batches and serves the same bytes back", async () => {
    const project = await create({ name: "Imports" });
    const scenes = server.app.get(ProjectScenesService);
    scenes.append(project.id, "prp_1", [box("a", "one")]);
    const response = await upload(project.id, GLB_HEADER);
    expect(response.status).toBe(201);
    const step = (await response.json()) as { kind: string; assetId: string; objectId: string; name: string; format: string };
    expect(step).toMatchObject({ kind: "import", objectId: "robot_glb", name: "robot.glb", format: "glb" });
    scenes.append(project.id, "prp_2", [box("b", "two")]);

    const scene = (await (await request(`/projects/${project.id}/scene`)).json()) as { steps: { kind: string }[] };
    expect(scene.steps.map((item) => item.kind)).toEqual(["commands", "import", "commands"]);

    const download = await request(`/projects/${project.id}/assets/${step.assetId}`);
    expect(download.status).toBe(200);
    expect(Buffer.from(await download.arrayBuffer()).equals(GLB_HEADER)).toBe(true);
  });

  it("rejects what it cannot keep: wrong format, empty or mislabeled files, wrong body type, duplicate ids", async () => {
    const project = await create();
    expect((await upload(project.id, GLB_HEADER, { format: "blend" })).status).toBe(400);
    expect((await upload(project.id, GLB_HEADER, { objectId: "bad id!" })).status).toBe(400);
    expect((await upload(project.id, Buffer.alloc(0))).status).toBe(422);
    expect((await upload(project.id, Buffer.from("not a glb file"))).status).toBe(422);
    expect((await upload(project.id, JSON.stringify({ a: 1 }), {}, "project-user", "application/json")).status).toBe(422);
    expect((await upload(project.id, GLB_HEADER)).status).toBe(201);
    expect((await upload(project.id, GLB_HEADER)).status).toBe(409);
    // Other formats are kept as they are; the app parses them.
    expect((await upload(project.id, "o cube", { name: "cube.obj", format: "obj", objectId: "cube_obj" })).status).toBe(201);
  });

  it("keeps imports private to the project's owner", async () => {
    const project = await create();
    expect((await upload(project.id, GLB_HEADER, {}, "intruder")).status).toBe(404);
    const step = (await (await upload(project.id, GLB_HEADER)).json()) as { assetId: string };
    expect((await request(`/projects/${project.id}/assets/${step.assetId}`, "GET", undefined, "intruder")).status).toBe(404);
    expect((await request(`/projects/${project.id}/assets/ast_00000000-0000-0000-0000-000000000000`)).status).toBe(404);
  });

  it("copies imported models into a duplicate, with ids of their own", async () => {
    const project = await create({ name: "Original" });
    const original = (await (await upload(project.id, GLB_HEADER)).json()) as { assetId: string };
    const copy = (await (await request(`/projects/${project.id}/duplicate`, "POST")).json()) as ProjectView;
    const copied = (await (await request(`/projects/${copy.id}/scene`)).json()) as { steps: { kind: string; assetId: string }[] };
    expect(copied.steps).toHaveLength(1);
    expect(copied.steps[0]?.assetId).not.toBe(original.assetId);
    const bytes = await request(`/projects/${copy.id}/assets/${copied.steps[0]?.assetId}`);
    expect(Buffer.from(await bytes.arrayBuffer()).equals(GLB_HEADER)).toBe(true);
  });
});

const move = (commandId: string, objectId: string, position: number[] = [1, 2, 3]): EditorCommand => ({
  type: "scene.transform_object",
  commandId,
  objectId,
  transform: { position: position as [number, number, number], rotation: [0, 0.5, 0], scale: [2, 2, 2] },
});

async function recordEdit(projectId: string, commands: unknown, user = "project-user") {
  return request(`/projects/${projectId}/scene/edits`, "POST", { commands }, user);
}

describe("edits made by the user", () => {
  it("adds primitives and transforms in one saved undoable action", async () => {
    const project = await create();
    for (const primitive of ["box", "sphere", "cylinder", "cone", "torus", "plane"]) {
      const commands = [{ ...box(`add-${primitive}`, primitive), primitive }, move(`place-${primitive}`, primitive)];
      expect((await recordEdit(project.id, commands)).status).toBe(201);
      expect((await recordEdit(project.id, commands)).status).toBe(422);
    }
    const scenes = server.app.get(ProjectScenesService); const undo = scenes.previewHistory(project.id, "undo");
    scenes.commitHistory(project.id, "undo", undo.version, "shapeUndo"); expect(scenes.list(project.id)).toHaveLength(5);
    const redo = scenes.previewHistory(project.id, "redo"); scenes.commitHistory(project.id, "redo", redo.version, "shapeRedo"); expect(scenes.list(project.id)).toHaveLength(6);
  });
  it("saves validated manual modifier stacks for existing objects only", async () => {
    const project = await create();
    server.app.get(ProjectScenesService).append(project.id, "base", [box("b", "crate")]);
    const command = { commandId: "modifier", type: "geometry.set_modifiers", objectId: "crate", meshPath: [], modifiers: [{ id: "smooth", kind: "subdivision", enabled: true, levels: 1 }] };
    expect((await recordEdit(project.id, [command])).status).toBe(201);
    expect((await recordEdit(project.id, [{ ...command, objectId: "missing" }])).status).toBe(422);
    expect((await recordEdit(project.id, [{ ...command, modifiers: [{ id: "bad", kind: "subdivision", levels: 4 }] }])).status).toBe(422);
    const scenes = server.app.get(ProjectScenesService);
    const undo = scenes.previewHistory(project.id, "undo");
    scenes.commitHistory(project.id, "undo", undo.version, "modifierUndo");
    expect(scenes.list(project.id)).toHaveLength(1);
    const redo = scenes.previewHistory(project.id, "redo");
    scenes.commitHistory(project.id, "redo", redo.version, "modifierRedo");
    expect(scenes.list(project.id)).toHaveLength(2);
  });
  it("are kept in the scene history in the order they happened, after the assistant's changes", async () => {
    const project = await create({ name: "Edited" });
    const scenes = server.app.get(ProjectScenesService);
    scenes.append(project.id, "prp_1", [box("a", "crate")]);
    const response = await recordEdit(project.id, [move("m1", "crate")]);
    expect(response.status).toBe(201);
    expect(((await response.json()) as { proposalId: string }).proposalId).toMatch(/^usr_/);
    scenes.append(project.id, "prp_2", [box("b", "lid")]);

    const scene = (await (await request(`/projects/${project.id}/scene`)).json()) as {
      steps: { kind: string; proposalId: string; commands: { type: string; objectId: string }[] }[];
    };
    expect(scene.steps.map((step) => step.commands[0]?.objectId)).toEqual(["crate", "crate", "lid"]);
    expect(scene.steps[1]?.commands[0]?.type).toBe("scene.transform_object");
  });

  it("saves renaming and re-parenting, for objects and parents that are in the project", async () => {
    const project = await create();
    server.app.get(ProjectScenesService).append(project.id, "prp_1", [box("a", "crate"), box("b", "lid")]);
    const rename = (commandId: string, objectId: string) => ({ type: "scene.rename_object", commandId, objectId, name: "Renamed" });
    const parent = (commandId: string, objectId: string, parentId: string | null) => ({ type: "scene.set_parent", commandId, objectId, parentId });
    expect((await recordEdit(project.id, [rename("r", "crate")])).status).toBe(201);
    expect((await recordEdit(project.id, [parent("p1", "lid", "crate")])).status).toBe(201);
    expect((await recordEdit(project.id, [parent("p2", "lid", null)])).status).toBe(201);
    // Neither the object nor the parent may be one the project does not have.
    expect((await recordEdit(project.id, [rename("r2", "ghost")])).status).toBe(422);
    expect((await recordEdit(project.id, [parent("p3", "ghost", "crate")])).status).toBe(422);
    expect((await recordEdit(project.id, [parent("p4", "lid", "ghost")])).status).toBe(422);
    // A parent added earlier in the same batch counts, and one the assistant deleted does not.
    expect((await recordEdit(project.id, [{ ...box("n", "fresh") }, parent("p5", "lid", "fresh")])).status).toBe(201);
    expect((await recordEdit(project.id, [{ type: "scene.delete_object", commandId: "d", objectId: "crate" }])).status).toBe(201);
    expect((await recordEdit(project.id, [parent("p6", "lid", "crate")])).status).toBe(422);
    const scene = (await (await request(`/projects/${project.id}/scene`)).json()) as { steps: { commands: { type: string }[] }[] };
    expect(scene.steps.flatMap((step) => step.commands.map((command) => command.type))).toEqual(expect.arrayContaining(["scene.rename_object", "scene.set_parent"]));
  });

  it("still refuses commands that are not edits a user makes by hand", async () => {
    const project = await create();
    server.app.get(ProjectScenesService).append(project.id, "prp_1", [box("a", "crate")]);
    const response = await recordEdit(project.id, [{ type: "scene.move_object", commandId: "m", objectId: "crate", delta: [1, 0, 0] }]);
    expect(response.status).toBe(422);
    expect(JSON.stringify(await response.json())).toContain("re-parenting");
  });

  it("can move imported models too", async () => {
    const project = await create();
    expect((await upload(project.id, GLB_HEADER)).status).toBe(201);
    expect((await recordEdit(project.id, [move("m1", "robot_glb")])).status).toBe(201);
  });

  it("refuses replacement primitives and references to missing objects", async () => {
    const project = await create();
    server.app.get(ProjectScenesService).append(project.id, "prp_1", [box("a", "crate")]);
    expect((await recordEdit(project.id, [{ ...box("b", "new"), replaceExisting: true }])).status).toBe(422);
    expect((await recordEdit(project.id, [move("m", "ghost")])).status).toBe(422);
    expect((await recordEdit(project.id, [{ type: "scene.transform_object", commandId: "x", objectId: "crate" }])).status).toBe(422);
    expect((await recordEdit(project.id, [])).status).toBe(400);
    expect((await recordEdit(project.id, "nope")).status).toBe(400);
  });

  it("can delete objects, and then know they are gone", async () => {
    const project = await create();
    server.app.get(ProjectScenesService).append(project.id, "prp_1", [box("a", "crate"), box("b", "lid")]);
    const remove = (commandId: string, objectId: string) => ({ type: "scene.delete_object", commandId, objectId });
    expect((await recordEdit(project.id, [remove("d1", "crate")])).status).toBe(201);
    expect((await recordEdit(project.id, [move("m", "crate")])).status).toBe(422);
    expect((await recordEdit(project.id, [remove("d2", "crate")])).status).toBe(422);
    // Within one batch, the second delete of the same object is refused as well.
    expect((await recordEdit(project.id, [remove("d3", "lid"), remove("d4", "lid")])).status).toBe(422);
    expect((await recordEdit(project.id, [move("m2", "lid"), remove("d5", "lid")])).status).toBe(201);
    const scene = (await (await request(`/projects/${project.id}/scene`)).json()) as { steps: unknown[] };
    expect(scene.steps).toHaveLength(3);
  });

  it("do not know about objects the assistant deleted", async () => {
    const project = await create();
    const scenes = server.app.get(ProjectScenesService);
    scenes.append(project.id, "prp_1", [box("a", "crate")]);
    scenes.append(project.id, "prp_2", [{ type: "scene.delete_object", commandId: "d", objectId: "crate" }]);
    expect((await recordEdit(project.id, [move("m", "crate")])).status).toBe(422);
  });

  it("wait while the assistant is working, and are private to the owner", async () => {
    const project = await create();
    server.app.get(ProjectScenesService).append(project.id, "prp_1", [box("a", "crate")]);
    expect((await recordEdit(project.id, [move("m", "crate")], "intruder")).status).toBe(404);
    insertRun(project.id, "build", "running");
    expect((await recordEdit(project.id, [move("m", "crate")])).status).toBe(409);
  });
});

describe("the object index of older projects", () => {
  it("is built from the history the first time a project is used, and kept after that", async () => {
    const project = await create({ name: "Older" });
    const db = server.app.get(DatabaseService).db;
    // A project stored before the index existed: its history is there, its index is not.
    db.prepare(
      "INSERT INTO project_scene_batches (project_id, seq, proposal_id, commands_json, applied_at) VALUES (?, 1, 'old-1', ?, ?)",
    ).run(project.id, JSON.stringify([box("a", "crate"), box("b", "lid")]), new Date().toISOString());
    expect(db.prepare("SELECT objects_indexed AS flag FROM projects WHERE id = ?").get(project.id)?.["flag"]).toBe(0);

    expect((await recordEdit(project.id, [move("m", "crate")])).status).toBe(201);
    expect((await recordEdit(project.id, [move("m2", "ghost")])).status).toBe(422);
    expect(db.prepare("SELECT objects_indexed AS flag FROM projects WHERE id = ?").get(project.id)?.["flag"]).toBe(1);

    // Later changes keep the index current, and a copy gets its own.
    server.app.get(ProjectScenesService).append(project.id, "prp_2", [{ type: "scene.delete_object", commandId: "d", objectId: "lid" }]);
    expect((await recordEdit(project.id, [move("m3", "lid")])).status).toBe(422);
    const copy = (await (await request(`/projects/${project.id}/duplicate`, "POST")).json()) as ProjectView;
    expect((await recordEdit(copy.id, [move("m4", "crate")])).status).toBe(201);
    expect((await recordEdit(copy.id, [move("m5", "lid")])).status).toBe(422);
  });

  it("is removed with the project", async () => {
    const project = await create();
    server.app.get(ProjectScenesService).append(project.id, "prp_1", [box("a", "crate")]);
    const db = server.app.get(DatabaseService).db;
    expect(db.prepare("SELECT COUNT(*) AS n FROM project_objects WHERE project_id = ?").get(project.id)?.["n"]).toBe(1);
    expect((await request(`/projects/${project.id}`, "DELETE")).status).toBe(204);
    expect(db.prepare("SELECT COUNT(*) AS n FROM project_objects WHERE project_id = ?").get(project.id)?.["n"]).toBe(0);
  });
});

describe("collections in edits made by the user", () => {
  const collection = (commandId: string, collectionId: string, parentCollectionId?: string) => ({ type: "scene.create_collection", commandId, collectionId, name: collectionId, ...(parentCollectionId ? { parentCollectionId } : {}) });
  const put = (commandId: string, objectId: string, collectionId: string | null) => ({ type: "scene.move_to_collection", commandId, objectId, collectionId, includeChildren: true });
  const scenesOf = () => server.app.get(ProjectScenesService);

  it("saves making, renaming, hiding, moving and deleting collections, and filling them", async () => {
    const project = await create();
    scenesOf().append(project.id, "prp_1", [box("a", "crate")]);
    expect((await recordEdit(project.id, [collection("c1", "set"), collection("c2", "props", "set"), put("m", "crate", "props")])).status).toBe(201);
    expect((await recordEdit(project.id, [{ type: "scene.rename_collection", commandId: "r", collectionId: "set", name: "Scene set" }])).status).toBe(201);
    expect((await recordEdit(project.id, [{ type: "scene.set_collection_visibility", commandId: "h", collectionId: "set", visible: false }])).status).toBe(201);
    expect((await recordEdit(project.id, [{ type: "scene.move_collection", commandId: "mv", collectionId: "props", parentCollectionId: null }])).status).toBe(201);
    expect((await recordEdit(project.id, [put("m2", "crate", null), { type: "scene.delete_collection", commandId: "d", collectionId: "props" }])).status).toBe(201);
    const scene = (await (await request(`/projects/${project.id}/scene`)).json()) as { steps: { commands: { type: string }[] }[] };
    expect(scene.steps.flatMap((step) => step.commands.map((command) => command.type))).toEqual(expect.arrayContaining(["scene.create_collection", "scene.move_to_collection", "scene.delete_collection"]));
  });

  it("refuses collections the project does not have, and ids that are already used", async () => {
    const project = await create();
    scenesOf().append(project.id, "prp_1", [box("a", "crate")]);
    await recordEdit(project.id, [collection("c1", "set")]);
    expect((await recordEdit(project.id, [collection("c2", "set")])).status).toBe(422);
    expect((await recordEdit(project.id, [collection("c3", "x", "ghost")])).status).toBe(422);
    expect((await recordEdit(project.id, [put("m", "crate", "ghost")])).status).toBe(422);
    expect((await recordEdit(project.id, [put("m", "ghost", "set")])).status).toBe(422);
    expect((await recordEdit(project.id, [{ type: "scene.rename_collection", commandId: "r", collectionId: "ghost", name: "X" }])).status).toBe(422);
    expect((await recordEdit(project.id, [{ ...box("n", "fresh"), collectionId: "ghost" }])).status).toBe(422);
    expect((await recordEdit(project.id, [{ ...box("n2", "fresh2"), collectionId: "set" }])).status).toBe(201);
  });

  it("knows a collection is gone after it is deleted, within a batch and after", async () => {
    const project = await create();
    await recordEdit(project.id, [collection("c1", "set")]);
    expect((await recordEdit(project.id, [{ type: "scene.delete_collection", commandId: "d1", collectionId: "set" }, { type: "scene.delete_collection", commandId: "d2", collectionId: "set" }])).status).toBe(422);
    expect((await recordEdit(project.id, [{ type: "scene.delete_collection", commandId: "d3", collectionId: "set" }])).status).toBe(201);
    expect((await recordEdit(project.id, [{ type: "scene.rename_collection", commandId: "r", collectionId: "set", name: "X" }])).status).toBe(422);
  });

  it("keeps the index right through undo and redo, so an undone collection can be made again", async () => {
    const project = await create();
    const scenes = scenesOf();
    expect((await recordEdit(project.id, [collection("c1", "set")])).status).toBe(201);
    expect((await recordEdit(project.id, [collection("c2", "set")])).status).toBe(422);
    const undo = scenes.previewHistory(project.id, "undo");
    scenes.commitHistory(project.id, "undo", undo.version, "collectionUndo");
    // The collection no longer exists, so naming it is refused and its id is free again.
    expect((await recordEdit(project.id, [{ type: "scene.rename_collection", commandId: "r", collectionId: "set", name: "X" }])).status).toBe(422);
    expect((await recordEdit(project.id, [collection("c3", "set")])).status).toBe(201);
  });

  it("cannot be mistaken for an object: a collection id and an object id may be the same", async () => {
    const project = await create();
    scenesOf().append(project.id, "prp_1", [box("a", "figure")]);
    expect((await recordEdit(project.id, [collection("c1", "figure"), put("m", "figure", "figure")])).status).toBe(201);
  });
});
