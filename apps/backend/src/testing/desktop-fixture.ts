import "reflect-metadata";
import {
  assistantMessage,
  functionCall,
  modelResponder,
} from "@openai/agents/testing";
import { startTestServer } from "./test-app.js";
import { ProvidersService } from "../modules/providers/providers.service.js";
import { ProviderTransport } from "../modules/providers/provider-transport.js";
import { EditorBridgeService } from "../modules/editor-bridge/editor-bridge.service.js";

/** Real HTTP, SSE, WebSocket and DPAPI; only vendor inference is scripted. Never included in production builds. */
export async function startDesktopFixture() {
  const server = await startTestServer();
  const userId = "desktop-e2e";
  const providers = server.app.get(ProvidersService);
  const transport = server.app.get(ProviderTransport);
  const bridge = server.app.get(EditorBridgeService);
  const execute = bridge.executeCommands.bind(bridge);
  let loseCommit = false;
  bridge.executeCommands = (clientId, request) => {
    if (loseCommit && request.phase === "commit") { loseCommit = false; return Promise.reject(new Error("Simulated lost commit delivery")); }
    return execute(clientId, request);
  };
  const modelSelections: { id: string; model: string }[] = [];
  transport.model = (credentials) => { modelSelections.push({ id: credentials.id, model: credentials.model }); return Promise.resolve(server.model); };
  transport.models = () => Promise.resolve(["test-model"]);
  await providers.save(userId, "openai", "test-model", "fake-e2e-key");
  function enqueueCreation() {
    server.model.enqueue(
      [functionCall("editor__get_context", {}, { callId: "context" })],
      [
        functionCall(
          "editor__propose_commands",
          {
            summary: "Add a cube",
            commands: [
              {
                commandId: "create-cube",
                type: "geometry.create_primitive",
                objectId: "cube",
                primitive: "box",
                size: 1,
                replaceExisting: false,
              },
            ],
          },
          { callId: "proposal" },
        ),
      ],
      modelResponder((call) => {
        const ids = JSON.stringify(call.request.input).match(
          /prp_[0-9a-f-]{36}/g,
        );
        const proposalId = ids?.at(-1);
        if (!proposalId) throw new Error("Proposal was not created");
        return [
          functionCall(
            "editor__apply_proposal",
            { proposalId },
            { callId: "apply" },
          ),
        ];
      }),
      [functionCall("validation__check_scene", {}, { callId: "verify-desktop-0" })], [assistantMessage("The cube is in your scene.")],
    );
  }
  function enqueueMeshModifiers() {
    server.model.enqueue(
      [functionCall("editor__inspect_mesh", { objectId: "model", meshPath: [0], offset: 0, limit: 5 }, { callId: "inspect" })],
      modelResponder((call) => {
        if (!JSON.stringify(call.request.input).includes("renderVertices")) throw new Error("Mesh details were not returned");
        return [functionCall("editor__propose_commands", { summary: "Bevel and smooth imported cube", commands: [
          { commandId: "bevel", type: "geometry.bevel", objectId: "model", meshPath: [0], width: .1 },
          { commandId: "subdivide", type: "geometry.subdivide", objectId: "model", meshPath: [0], levels: 1 },
        ] }, { callId: "propose-modifiers" })];
      }),
      modelResponder((call) => {
        const proposalId = JSON.stringify(call.request.input).match(/prp_[0-9a-f-]{36}/g)?.at(-1);
        if (!proposalId) throw new Error("Missing modifier proposal");
        return [functionCall("editor__apply_proposal", { proposalId }, { callId: "apply-modifiers" })];
      }),
      [functionCall("validation__check_scene", {}, { callId: "verify-desktop-1" })], [assistantMessage("The mesh is beveled and subdivided.")],
    );
  }
  function enqueueRoundedCut() {
    server.model.enqueue(
      [functionCall("editor__propose_commands", { summary: "Cut and round the target", commands: [
        { commandId: "cut", type: "geometry.boolean", objectId: "target", operandObjectId: "cutter" },
        { commandId: "round", type: "geometry.bevel", objectId: "target", profile: "circular", width: 0.035, segments: 4 },
      ] }, { callId: "propose-cut" })],
      modelResponder((call) => {
        const proposalId = JSON.stringify(call.request.input).match(/prp_[0-9a-f-]{36}/g)?.at(-1);
        if (!proposalId) throw new Error("Missing Boolean proposal");
        return [functionCall("editor__apply_proposal", { proposalId }, { callId: "apply-cut" })];
      }),
      [functionCall("validation__check_scene", {}, { callId: "verify-desktop-2" })], [assistantMessage("The target is cut and rounded.")],
    );
  }
  return {
    enqueueDuplication: (expectedRevision: number) => server.model.enqueue(
      [functionCall("editor__plan_duplicates", { sourceId: "root", copies: 1, offset: [3, 0, 0] }, { callId: "plan-copies" })],
      [functionCall("editor__propose_commands", { summary: "Copy assembly", expectedRevision, commands: [{ commandId: "copy", type: "scene.duplicate_hierarchy", sourceId: "root",
        copies: [{ objectId: "copy", descendants: [{ sourceId: "child", objectId: "child-copy" }] }], offset: [3, 0, 0], space: "world",
      }] }, { callId: "propose-copy" })],
      modelResponder((call) => {
        const proposalId = JSON.stringify(call.request.input).match(/prp_[0-9a-f-]{36}/g)?.at(-1);
        if (!proposalId) throw new Error("Missing copy proposal");
        return [functionCall("editor__apply_proposal", { proposalId }, { callId: "apply-copy" })];
      }), [functionCall("validation__check_scene", {}, { callId: "verify-desktop-3" })], [assistantMessage("The assembly copy is saved.")],
    ),
    enqueueRepetition: (expectedRevision: number, kind: "array" | "mirror") => server.model.enqueue(
      [functionCall("editor__inspect_mesh", { objectId: "box", view: "base" }, { callId: "inspect-repetition" })],
      [functionCall("editor__propose_commands", { summary: "Repeat mesh", expectedRevision, commands: [{ commandId: "repeat", type: "geometry.set_modifiers", objectId: "box",
        modifiers: kind === "array" ? [{ id: "array", kind, enabled: true, count: 3, offset: [3, 0, 0] }] : [{ id: "mirror", kind, enabled: true, axis: "x", origin: 0, bisect: true, keepSide: "positive", mergeDistance: 1e-6 }],
      }] }, { callId: "propose-repetition" })],
      modelResponder((call) => {
        const proposalId = JSON.stringify(call.request.input).match(/prp_[0-9a-f-]{36}/g)?.at(-1);
        if (!proposalId) throw new Error("Missing repetition proposal");
        return [functionCall("editor__apply_proposal", { proposalId }, { callId: "apply-repetition" })];
      }), [functionCall("validation__check_scene", {}, { callId: "verify-desktop-4" })], [assistantMessage("The live repetition is saved.")],
    ),
    enqueueMaterialEdit: (expectedRevision: number, edit: Record<string, unknown>) => server.model.enqueue(
      [functionCall("editor__inspect_materials", { objectId: "box" }, { callId: "inspect-materials" })],
      modelResponder((call) => {
        if (!JSON.stringify(call.request.input).includes("materialSlotCount")) throw new Error("Material slots did not reach the model");
        return [functionCall("editor__propose_commands", { summary: "Change material", expectedRevision,
          commands: [{ ...edit, commandId: "material", objectId: "box" }],
        }, { callId: "propose-material" })];
      }),
      modelResponder((call) => {
        const proposalId = JSON.stringify(call.request.input).match(/prp_[0-9a-f-]{36}/g)?.at(-1);
        if (!proposalId) throw new Error("Missing material proposal");
        return [functionCall("editor__apply_proposal", { proposalId }, { callId: "apply-material" })];
      }),
      [functionCall("validation__check_scene", {}, { callId: "verify-desktop-5" })], [assistantMessage("The material edit is saved.")],
    ),
    enqueueTopologyEdit: (expectedRevision: number, edit: Record<string, unknown>) => server.model.enqueue(
      [functionCall("editor__inspect_mesh", { objectId: "mesh", meshPath: [], view: "base", offset: 0, limit: 100 }, { callId: "inspect-topology" })],
      [functionCall("editor__propose_commands", { summary: "Edit mesh topology", expectedRevision,
        commands: [{ ...edit, commandId: "topology", objectId: "mesh", componentView: "base" }],
      }, { callId: "propose-topology" })],
      modelResponder((call) => {
        const proposalId = JSON.stringify(call.request.input).match(/prp_[0-9a-f-]{36}/g)?.at(-1);
        if (!proposalId) throw new Error("Missing topology proposal");
        return [functionCall("editor__apply_proposal", { proposalId }, { callId: "apply-topology" })];
      }),
      [functionCall("validation__check_scene", {}, { callId: "verify-desktop-6" })], [assistantMessage("The mesh edit is saved.")],
    ),
    enqueueComponentTransform: (expectedRevision: number, kind: "vertex" | "edge", ids: string[]) => server.model.enqueue(
      [functionCall("editor__inspect_mesh", { objectId: "box", meshPath: [], view: "base", offset: 0, limit: 25 }, { callId: "inspect-components" })],
      [functionCall("editor__propose_commands", { summary: "Move base components", expectedRevision, commands: [{
        commandId: "move-components", type: "geometry.transform_components", objectId: "box", kind, ids,
        componentView: "base", space: "local", transform: { position: [0, 0, 0.1] },
      }] }, { callId: "propose-components" })],
      modelResponder((call) => {
        const proposalId = JSON.stringify(call.request.input).match(/prp_[0-9a-f-]{36}/g)?.at(-1);
        if (!proposalId) throw new Error("Missing component proposal");
        return [functionCall("editor__apply_proposal", { proposalId }, { callId: "apply-components" })];
      }),
      [functionCall("validation__check_scene", {}, { callId: "verify-desktop-7" })], [assistantMessage("The base components have moved.")],
    ),
    enqueueMeasurement: () => server.model.enqueue(
      [functionCall("editor__measure", { request: { kind: "distance", from: [0, 0, 0], to: [3, 4, 0] } }, { callId: "measure" })],
      modelResponder((call) => {
        const text = JSON.stringify(call.request.input);
        if (!text.includes("metersPerSceneUnit") || !text.includes("length")) throw new Error("Measurement response did not reach the model");
        return [assistantMessage("Measured and verified.")];
      }),
    ),
    modelSelections,
    port: Number(new URL(server.baseUrl).port),
    token: server.token(userId),
    close: () => server.close(),
    enqueueCreation,
    enqueueMeshModifiers,
    enqueueRoundedCut,
    loseNextCommit: () => { loseCommit = true; },
  };
}
