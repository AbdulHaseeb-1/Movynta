import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Scene } from "three";
import { z } from "zod";
import { startDesktopFixture } from "../../backend/.test-output/testing/desktop-fixture.js";
import { EditorScene } from "../src/features/assistant/EditorScene";
import { connectEditor } from "../src/features/assistant/editorConnection";
import {
  acceptedSchema,
  getRun,
  streamRun,
} from "../src/features/assistant/runClient";
import { backendRequest, setBackendToken } from "../src/lib/backend";
import { providersSchema } from "../src/features/providers";
import { changeSceneHistory } from "../src/features/objectEditing/sceneHistory";
import { saveManualCommands } from "../src/features/objectEditing/saveManualCommands";
import { ensureManifold } from "../src/features/meshGeometry/meshBoolean";
import { assertManifold, faceNormal, readTopology, topology } from "../src/features/meshGeometry/meshTopology";

let fixture: Awaited<ReturnType<typeof startDesktopFixture>>;
beforeAll(async () => {
  await ensureManifold();
  vi.stubGlobal("window", globalThis);
  fixture = await startDesktopFixture();
  setBackendToken(fixture.token, fixture.port);
}, 60000);
afterAll(async () => {
  await fixture?.close();
  vi.unstubAllGlobals();
});
describe("real desktop/backend protocol", () => {
  it("duplicates a hierarchy, indexes its descendants, and persists undo/redo", async () => {
    const project = await backendRequest("/projects", z.object({ id: z.string() }), "POST", {});
    const editor = new EditorScene(new Scene(), project.id), abort = new AbortController(), connection = await connectEditor(editor, abort.signal);
    try {
      await saveManualCommands(editor, [
        { commandId: "root", type: "geometry.create_primitive", objectId: "root", primitive: "box", size: 2, name: "Assembly" },
        { commandId: "child", type: "geometry.create_primitive", objectId: "child", parentId: "root", primitive: "box", size: 1, transform: { position: [0, 2, 0] } },
      ]);
      fixture.enqueueDuplication(editor.currentRevision);
      const run = await backendRequest("/agent-runs", acceptedSchema, "POST", { projectId: project.id, editorClientId: connection.clientId, message: "Duplicate the assembly beside the original" });
      await streamRun(run.eventsUrl, abort.signal, () => {}); expect((await getRun(run.runId)).status).toBe("completed");
      expect(editor.getObject("child-copy")?.parent).toBe(editor.getObject("copy")); expect(editor.getObject("copy")?.position.x).toBe(3);
      await saveManualCommands(editor, [{ commandId: "rename", type: "scene.rename_object", objectId: "child-copy", name: "Copied child" }]);
      await changeSceneHistory(editor, "undo");
      await changeSceneHistory(editor, "undo"); expect(editor.getObject("copy")).toBeUndefined(); expect(editor.getObject("child-copy")).toBeUndefined();
      await changeSceneHistory(editor, "redo"); expect(editor.getObject("child-copy")?.parent).toBe(editor.getObject("copy"));
    } finally { connection.close(); abort.abort(); }
  }, 60000);
  it.each(["array", "mirror"] as const)("saves live %s repetition and editable base/stack changes", async (kind) => {
    const project = await backendRequest("/projects", z.object({ id: z.string() }), "POST", {});
    const editor = new EditorScene(new Scene(), project.id), abort = new AbortController(), connection = await connectEditor(editor, abort.signal);
    try {
      await saveManualCommands(editor, [{ commandId: "box", type: "geometry.create_primitive", objectId: "box", primitive: "box", size: 2 }]);
      fixture.enqueueRepetition(editor.currentRevision, kind);
      const run = await backendRequest("/agent-runs", acceptedSchema, "POST", { projectId: project.id, editorClientId: connection.clientId, message: "Add live repetition to the box" });
      await streamRun(run.eventsUrl, abort.signal, () => {}); expect((await getRun(run.runId)).status).toBe("completed");
      const inspect = (view: "base" | "evaluated") => editor.context({ objectId: "box", meshPath: [], view, offset: 0, limit: 100 }).meshInspection;
      expect(inspect("base")?.modifiers?.[0]?.kind).toBe(kind);
      const before = inspect("evaluated")?.localBounds;
      if (kind === "array") await saveManualCommands(editor, [{ commandId: "count", type: "geometry.set_modifiers", objectId: "box", modifiers: [{ id: "array", kind: "array", enabled: true, count: 4, offset: [3, 0, 0] }] }]);
      else {
        const face = inspect("base")?.faces.find((face) => face.vertices.every((id) => (inspect("base")?.vertices.find((v) => v.index === id)?.position[0] ?? 0) > 0));
        if (!face) throw new Error("Missing positive face");
        await saveManualCommands(editor, [{ commandId: "base", type: "geometry.transform_faces", objectId: "box", ids: [String(face.index)], componentView: "base", transform: { position: [0.2, 0, 0] } }]);
      }
      const after = inspect("evaluated")?.localBounds; expect(after).not.toEqual(before);
      if (kind === "mirror") { expect(after?.max[0]).toBeCloseTo(1.2); expect(after?.min[0]).toBeCloseTo(-1.2); }
      await changeSceneHistory(editor, "undo"); expect(inspect("evaluated")?.localBounds).toEqual(before);
      await changeSceneHistory(editor, "redo"); expect(inspect("evaluated")?.localBounds).toEqual(after);
    } finally { connection.close(); abort.abort(); }
  }, 60000);
  it("inspects and edits materials, assigns base faces, and saves undo/redo", async () => {
    const project = await backendRequest("/projects", z.object({ id: z.string() }), "POST", {});
    const editor = new EditorScene(new Scene(), project.id), abort = new AbortController();
    const connection = await connectEditor(editor, abort.signal);
    try {
      await saveManualCommands(editor, [{ commandId: "box", type: "geometry.create_primitive", objectId: "box", primitive: "box", size: 2 }]);
      const inspect = () => editor.context({ objectId: "box", meshPath: [], offset: 0, limit: 25, materialsOnly: true }).meshInspection;
      const fingerprint = () => {
        const object = editor.getObject("box"); if (!(object instanceof Mesh)) throw new Error("Missing box");
        return JSON.stringify({ slots: inspect()?.materials, assignments: readTopology(object.geometry).channels?.materials });
      };
      const apply = async (edit: Record<string, unknown>) => {
        fixture.enqueueMaterialEdit(editor.currentRevision, edit);
        const run = await backendRequest("/agent-runs", acceptedSchema, "POST", { projectId: project.id, editorClientId: connection.clientId, message: "Update the box material" });
        const approvals: string[] = [];
        await streamRun(run.eventsUrl, abort.signal, (event) => { if (event.type === "approval.required") approvals.push(event.type); });
        expect((await getRun(run.runId)).status).toBe("completed"); expect(approvals).toHaveLength(0);
      };
      await apply({ type: "material.set_properties", slot: 0, properties: { color: "#d98855", roughness: 0.25, metalness: 0.8 } });
      expect(inspect()?.materials?.[0]).toMatchObject({ color: "#d98855", metalness: 0.8 });
      await apply({ type: "material.add_slot", slot: 1, properties: { color: "#1144ff", name: "Blue" } });
      const before = fingerprint();
      await apply({ type: "material.assign", slot: 1, ids: ["0"] });
      const after = fingerprint(); expect(after).not.toBe(before);
      await changeSceneHistory(editor, "undo"); expect(fingerprint()).toBe(before);
      await changeSceneHistory(editor, "redo"); expect(fingerprint()).toBe(after);
      await apply({ type: "material.replace_slot", slot: 1, properties: { color: "#22cc88", roughness: 0.5 } });
      const object = editor.getObject("box");
      expect(object instanceof Mesh && Array.isArray(object.material) && object.material[1] instanceof MeshStandardMaterial).toBe(true);
      expect(inspect()?.materials?.[1]?.color).toBe("#22cc88");
    } finally { connection.close(); abort.abort(); }
  }, 60000);
  it.each(["merge", "dissolve", "slide", "loop"] as const)("saves an automatic %s edit and replays undo/redo", async (operation) => {
    const project = await backendRequest("/projects", z.object({ id: z.string() }), "POST", {});
    const editor = new EditorScene(new Scene(), project.id), abort = new AbortController();
    const connection = await connectEditor(editor, abort.signal);
    try {
      const sheet = operation === "dissolve" || operation === "slide";
      await saveManualCommands(editor, [{ commandId: "mesh", type: "geometry.create_primitive", objectId: "mesh", primitive: sheet ? "plane" : "box", size: 2 }]);
      if (sheet) await saveManualCommands(editor, [{ commandId: "split", type: "geometry.subdivide_faces", objectId: "mesh", ids: ["0"] }]);
      const cage = () => {
        const object = editor.getObject("mesh"); if (!(object instanceof Mesh)) throw new Error("Missing mesh"); return readTopology(object.geometry);
      };
      const fingerprint = () => JSON.stringify({ positions: cage().positions.map((p) => p.toArray()), faces: cage().faces });
      const mesh = cage(), graph = topology(mesh);
      const seed = graph.edges.keys().next().value;
      if (!seed) throw new Error("Missing seed edge");
      let edit: Record<string, unknown>;
      if (operation === "merge") edit = { type: "geometry.merge_vertices", ids: seed.split("_"), mode: "center" };
      else if (operation === "loop") edit = { type: "geometry.loop_cut", edge: seed, cuts: 2 };
      else if (operation === "dissolve") edit = { type: "geometry.dissolve_edges", ids: [...graph.edges].filter(([, half]) => half.length === 2).map(([id]) => id) };
      else {
        const edge = [...graph.edges].find(([, half]) => half.length === 2)?.[0];
        if (!edge) throw new Error("Missing slide edge");
        const selected = edge.split("_");
        const rails = selected.map((vertex) => {
          const neighbor = (graph.vertexEdges[Number(vertex)] ?? []).flatMap((id) => id.split("_")).find((id) => !selected.includes(id));
          if (!neighbor) throw new Error("Missing rail"); return { vertex, toward: neighbor };
        });
        edit = { type: "geometry.slide_edges", ids: [edge], rails, factor: 0.2 };
      }
      const before = fingerprint();
      fixture.enqueueTopologyEdit(editor.currentRevision, edit);
      const run = await backendRequest("/agent-runs", acceptedSchema, "POST", { projectId: project.id, editorClientId: connection.clientId, message: "Edit the selected mesh topology" });
      const approvals: string[] = [];
      await streamRun(run.eventsUrl, abort.signal, (event) => { if (event.type === "approval.required") approvals.push(event.type); });
      expect((await getRun(run.runId)).status).toBe("completed");
      expect(approvals).toHaveLength(0);
      const after = fingerprint(); expect(after).not.toBe(before);
      await changeSceneHistory(editor, "undo"); expect(fingerprint()).toBe(before);
      await changeSceneHistory(editor, "redo"); expect(fingerprint()).toBe(after);
    } finally { connection.close(); abort.abort(); }
  }, 30000);
  it.each(["vertex", "edge"] as const)("automatically applies %s transforms and persists undo/redo", async (kind) => {
    const project = await backendRequest("/projects", z.object({ id: z.string() }), "POST", {});
    const editor = new EditorScene(new Scene(), project.id), abort = new AbortController();
    const connection = await connectEditor(editor, abort.signal);
    try {
      await saveManualCommands(editor, [{ commandId: "box", type: "geometry.create_primitive", objectId: "box", primitive: "box", size: 1 }]);
      const cage = () => {
        const object = editor.getObject("box");
        if (!(object instanceof Mesh)) throw new Error("Missing box");
        return readTopology(object.geometry);
      };
      const firstEdge = topology(cage()).edges.keys().next().value;
      if (!firstEdge) throw new Error("Missing edge");
      const ids = kind === "vertex" ? ["0"] : [firstEdge];
      const vertex = Number(ids[0]?.split("_")[0]);
      const before = cage().positions[vertex]?.z;
      if (before === undefined) throw new Error("Missing vertex");
      fixture.enqueueComponentTransform(editor.currentRevision, kind, ids);
      const run = await backendRequest("/agent-runs", acceptedSchema, "POST", { projectId: project.id, editorClientId: connection.clientId, message: "Move these mesh components slightly along local Z" });
      const approvals: string[] = [];
      await streamRun(run.eventsUrl, abort.signal, (event) => { if (event.type === "approval.required") approvals.push(event.type); });
      expect((await getRun(run.runId)).status).toBe("completed");
      expect(approvals).toHaveLength(0);
      expect(cage().positions[vertex]?.z).toBeCloseTo(before + 0.1);
      await changeSceneHistory(editor, "undo");
      expect(cage().positions[vertex]?.z).toBeCloseTo(before);
      await changeSceneHistory(editor, "redo");
      expect(cage().positions[vertex]?.z).toBeCloseTo(before + 0.1);
    } finally { connection.close(); abort.abort(); }
  }, 30000);
  it("returns calibrated measurements through the model tool and editor WebSocket", async () => {
    const project = await backendRequest("/projects", z.object({ id: z.string() }), "POST", {});
    await backendRequest(`/projects/${project.id}/measurements`, z.unknown(), "PATCH", {
      expectedVersion: 0, value: { units: { display: "cm", metersPerSceneUnit: 1 }, annotations: [] },
    });
    fixture.enqueueMeasurement();
    const editor = new EditorScene(new Scene(), project.id), abort = new AbortController();
    const connection = await connectEditor(editor, abort.signal);
    try {
      const run = await backendRequest("/agent-runs", acceptedSchema, "POST", { projectId: project.id, editorClientId: connection.clientId, message: "Measure the distance between the two points" });
      await streamRun(run.eventsUrl, abort.signal, () => {});
      expect((await getRun(run.runId)).status).toBe("completed");
    } finally { connection.close(); abort.abort(); }
  }, 30000);
  it("recovers a durably saved edit after commit delivery is lost and the editor reconnects", async () => {
    const project = await backendRequest("/projects", z.object({ id: z.string() }), "POST", {});
    fixture.enqueueCreation(); fixture.loseNextCommit();
    const editor = new EditorScene(new Scene(), project.id); const abort = new AbortController();
    const connection = await connectEditor(editor, abort.signal);
    try {
      const run = await backendRequest("/agent-runs", acceptedSchema, "POST", { projectId: project.id, editorClientId: connection.clientId, message: "Create a cube" });
      await streamRun(run.eventsUrl, abort.signal, () => {});
      expect((await getRun(run.runId)).status).toBe("completed");
      expect(editor.getObject("cube")).toBeUndefined();
    } finally { connection.close(); abort.abort(); }
    const resumed = new AbortController(); const newConnection = await connectEditor(editor, resumed.signal);
    try { expect(editor.getObject("cube")).toBeDefined(); }
    finally { newConnection.close(); resumed.abort(); }
  }, 30000);
  it("undoes and redoes a saved assistant edit through the project history API", async () => {
    const project = await backendRequest("/projects", z.object({ id: z.string() }), "POST", {});
    fixture.enqueueCreation();
    const editor = new EditorScene(new Scene(), project.id); const abort = new AbortController();
    const connection = await connectEditor(editor, abort.signal);
    try {
      const run = await backendRequest("/agent-runs", acceptedSchema, "POST", { projectId: project.id, editorClientId: connection.clientId, message: "Create a cube" });
      await streamRun(run.eventsUrl, abort.signal, () => {});
      expect((await getRun(run.runId)).status).toBe("completed"); expect(editor.getObject("cube")).toBeDefined();
      await changeSceneHistory(editor, "undo"); expect(editor.getObject("cube")).toBeUndefined();
      await changeSceneHistory(editor, "redo"); expect(editor.getObject("cube")).toBeDefined();
    } finally { connection.close(); abort.abort(); }
  }, 30000);
  it("inspects an imported mesh and automatically applies bevel and subdivision", async () => {
    fixture.enqueueMeshModifiers();
    const editor = new EditorScene(new Scene(), "desktop-modifiers");
    const root = new Group(); const mesh = new Mesh(new BoxGeometry()); root.add(mesh); editor.importObject("model", root);
    const original = mesh.geometry;
    const abort = new AbortController(); const connection = await connectEditor(editor, abort.signal);
    try {
      const run = await backendRequest("/agent-runs", acceptedSchema, "POST", { projectId: editor.projectId, editorClientId: connection.clientId, message: "Bevel and subdivide my imported cube" });
      const approvals: string[] = [];
      await streamRun(run.eventsUrl, abort.signal, (event) => {
        if (event.type === "approval.required") approvals.push(event.type);
      });
      expect(approvals).toHaveLength(0);
      expect((await getRun(run.runId)).status).toBe("completed");
      const displayed = editor.getObject("model")?.children[0];
      expect(displayed).toBeInstanceOf(Mesh);
      if (displayed instanceof Mesh) expect(displayed.geometry).not.toBe(original);
      expect(editor.context({ objectId: "model", meshPath: [0], offset: 0, limit: 1 }).meshInspection?.stats?.faces).toBe(96);
    } finally { connection.close(); abort.abort(); }
  }, 30000);
  it("automatically applies a rounded Boolean batch and persists a manual cutter face move", async () => {
    const project = await backendRequest("/projects", z.object({ id: z.string() }), "POST", {});
    const editor = new EditorScene(new Scene(), project.id);
    const abort = new AbortController();
    const connection = await connectEditor(editor, abort.signal);
    try {
      await saveManualCommands(editor, [
        { commandId: "target", type: "geometry.create_primitive", objectId: "target", primitive: "box", size: 1 },
        { commandId: "cutter", type: "geometry.create_primitive", objectId: "cutter", primitive: "box", size: 1 },
        { commandId: "place", type: "scene.transform_object", objectId: "cutter", transform: { position: [0.5, 0.5, 0.5] } },
      ]);
      fixture.enqueueRoundedCut();
      const run = await backendRequest("/agent-runs", acceptedSchema, "POST", { projectId: project.id, editorClientId: connection.clientId, message: "Cut and round the target" });
      const approvals: string[] = [];
      await streamRun(run.eventsUrl, abort.signal, (event) => {
        if (event.type === "approval.required") approvals.push(event.type);
      });
      expect(approvals).toHaveLength(0);
      expect((await getRun(run.runId)).status).toBe("completed");
      expect(editor.context({ objectId: "target", meshPath: [], offset: 0, limit: 1 }).meshInspection?.modifiers?.map(({ kind }) => kind)).toEqual(["boolean", "bevel"]);
      const mesh = (id: string) => {
        const object = editor.getObject(id);
        if (!(object instanceof Mesh)) throw new Error(`Missing mesh ${id}`);
        return object;
      };
      await saveManualCommands(editor, [{ commandId: "hide-cutter", type: "scene.set_visibility", objectId: "cutter", visible: false }]);
      expect(mesh("cutter").visible).toBe(false);
      await changeSceneHistory(editor, "undo");
      expect(mesh("cutter").visible).toBe(true);
      await changeSceneHistory(editor, "redo");
      expect(mesh("cutter").visible).toBe(false);
      const beforeMove = mesh("target").geometry;
      const cutter = readTopology(mesh("cutter").geometry);
      const side = cutter.faces.findIndex((face) => faceNormal(cutter, face).x < -0.9);
      await saveManualCommands(editor, [{
        commandId: "shift-cutter", type: "geometry.transform_faces", objectId: "cutter",
        ids: [String(side)], transform: { position: [-0.1, 0, 0] },
      }]);
      expect(mesh("target").geometry).not.toBe(beforeMove);
      const rounded = readTopology(mesh("target").geometry);
      expect(() => assertManifold(rounded, topology(rounded), true)).not.toThrow();
      await changeSceneHistory(editor, "undo");
      expect(readTopology(mesh("cutter").geometry).positions).toEqual(cutter.positions);
      await changeSceneHistory(editor, "redo");
      expect(readTopology(mesh("cutter").geometry).positions).not.toEqual(cutter.positions);
    } finally { connection.close(); abort.abort(); }
  }, 30000);
  it("configures and selects each fixed provider through frontend API code", async () => {
    for (const id of [
      "openai",
      "anthropic",
      "google",
      "openai-compatible",
      "anthropic-compatible",
    ]) {
      const providers = await backendRequest(
        `/providers/${id}`,
        providersSchema,
        "POST",
        {
          model: "test-model",
          apiKey: "fake-e2e-key",
          ...(id.endsWith("-compatible")
            ? { baseUrl: "http://localhost:1234/v1" }
            : {}),
        },
      );
      expect(providers.find((item) => item.id === id)?.configured).toBe(true);
      const selected = await backendRequest(
        "/providers/active",
        providersSchema,
        "POST",
        { id },
      );
      expect(selected.find((item) => item.active)?.id).toBe(id);
      expect(
        await backendRequest(
          `/providers/${id}/test`,
          z.object({ connected: z.boolean() }),
          "POST",
        ),
      ).toEqual({ connected: true });
    }
  }, 30000);
  it("submits a prompt, streams progress, and applies agent proposals to real Three.js objects", async () => {
    fixture.enqueueCreation();
    const scene = new Scene();
    const editor = new EditorScene(scene, "desktop-project");
    const abort = new AbortController();
    const connection = await connectEditor(editor, abort.signal);
    try {
      const run = await backendRequest("/agent-runs", acceptedSchema, "POST", {
        projectId: editor.projectId,
        message: "Create a cube",
        dimension: "3d",
        useConfiguredProvider: true,
        providerId: "openai",
        model: "assistant-selected-model",
        editorClientId: connection.clientId,
      });
      const events: string[] = [];
      await streamRun(run.eventsUrl, abort.signal, (event) =>
        events.push(event.type),
      );
      const finished = await getRun(run.runId);
      expect(finished.status).toBe("completed");
      expect(fixture.modelSelections.at(-1)).toEqual({ id: "openai", model: "assistant-selected-model" });
      expect(finished.finalOutput).toBe("The cube is in your scene.");
      expect(events).toContain("editor.proposal.created");
      expect(scene.children).toHaveLength(1);
      expect(editor.context().objects[0]?.id).toBe("cube");
    } finally {
      connection.close();
      abort.abort();
    }
  }, 30000);
});
