import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Scene } from "three";
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

let fixture: Awaited<ReturnType<typeof startDesktopFixture>>;
beforeAll(async () => {
  vi.stubGlobal("window", globalThis);
  fixture = await startDesktopFixture();
  setBackendToken(fixture.token, fixture.port);
}, 60000);
afterAll(async () => {
  await fixture?.close();
  vi.unstubAllGlobals();
});
describe("real desktop/backend protocol", () => {
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
