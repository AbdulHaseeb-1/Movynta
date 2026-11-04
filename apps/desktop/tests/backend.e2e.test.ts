import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { BoxGeometry, Group, Mesh, Scene } from "three";
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
  it("inspects an imported mesh and applies approved bevel and subdivision", async () => {
    fixture.enqueueMeshModifiers();
    const editor = new EditorScene(new Scene(), "desktop-modifiers");
    const root = new Group(); const mesh = new Mesh(new BoxGeometry()); root.add(mesh); editor.importObject("model", root);
    const original = mesh.geometry;
    const abort = new AbortController(); const connection = await connectEditor(editor, abort.signal);
    try {
      const run = await backendRequest("/agent-runs", acceptedSchema, "POST", { projectId: editor.projectId, editorClientId: connection.clientId, message: "Bevel and subdivide my imported cube" });
      let requested: (id: string) => void = () => {};
      const approval = new Promise<string>((resolve) => { requested = resolve; });
      const streaming = streamRun(run.eventsUrl, abort.signal, (event) => {
        if (event.type === "approval.required" && typeof event.payload["approvalId"] === "string") requested(event.payload["approvalId"]);
      });
      const approvalId = await Promise.race([approval, streaming.then(() => { throw new Error("Run ended without modifier approval"); })]);
      expect(mesh.geometry).toBe(original);
      await backendRequest(`/agent-runs/${run.runId}/approvals/${approvalId}`, z.unknown(), "POST", { decision: "approve" });
      await streaming;
      expect((await getRun(run.runId)).status).toBe("completed");
      const displayed = editor.getObject("model")?.children[0];
      expect(displayed).toBeInstanceOf(Mesh);
      if (displayed instanceof Mesh) expect(displayed.geometry).not.toBe(original);
      expect(editor.context({ objectId: "model", meshPath: [0], offset: 0, limit: 1 }).meshInspection?.stats?.faces).toBe(96);
    } finally { connection.close(); abort.abort(); }
  }, 30000);
  it("applies an approved rounded Boolean batch and persists a manual cutter face move", async () => {
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
      let resolveApproval: (id: string) => void = () => {};
      const approval = new Promise<string>((resolve) => { resolveApproval = resolve; });
      const streaming = streamRun(run.eventsUrl, abort.signal, (event) => {
        if (event.type === "approval.required" && typeof event.payload["approvalId"] === "string") resolveApproval(event.payload["approvalId"]);
      });
      const approvalId = await Promise.race([approval, streaming.then(() => { throw new Error("Run ended without Boolean approval"); })]);
      expect(editor.context({ objectId: "target", meshPath: [], offset: 0, limit: 1 }).meshInspection?.modifiers).toHaveLength(0);
      await backendRequest(`/agent-runs/${run.runId}/approvals/${approvalId}`, z.unknown(), "POST", { decision: "approve" });
      await streaming;
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
