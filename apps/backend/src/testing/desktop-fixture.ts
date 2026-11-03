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
      [assistantMessage("The cube is in your scene.")],
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
      [assistantMessage("The mesh is beveled and subdivided.")],
    );
  }
  return {
    modelSelections,
    port: Number(new URL(server.baseUrl).port),
    token: server.token(userId),
    close: () => server.close(),
    enqueueCreation,
    enqueueMeshModifiers,
    loseNextCommit: () => { loseCommit = true; },
  };
}
