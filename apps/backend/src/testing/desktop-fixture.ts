import "reflect-metadata";
import {
  assistantMessage,
  functionCall,
  modelResponder,
} from "@openai/agents/testing";
import { startTestServer } from "./test-app.js";
import { ProvidersService } from "../modules/providers/providers.service.js";
import { ProviderTransport } from "../modules/providers/provider-transport.js";

/** Real HTTP, SSE, WebSocket and DPAPI; only vendor inference is scripted. Never included in production builds. */
export async function startDesktopFixture() {
  const server = await startTestServer();
  const userId = "desktop-e2e";
  const providers = server.app.get(ProvidersService);
  const transport = server.app.get(ProviderTransport);
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
  return {
    modelSelections,
    port: Number(new URL(server.baseUrl).port),
    token: server.token(userId),
    close: () => server.close(),
    enqueueCreation,
  };
}
