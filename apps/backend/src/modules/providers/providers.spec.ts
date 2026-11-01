import { jest } from "@jest/globals";
import { startTestServer } from "../../testing/test-app.js";
import { ProviderTransport } from "./provider-transport.js";
import { DatabaseService } from "../persistence/database.service.js";
import { WindowsSecretProtector } from "./secret-protector.js";
import { ProvidersService } from "./providers.service.js";
import { openEventStream } from "../../testing/event-stream.js";
import { assistantMessage } from "@openai/agents/testing";
import type { TestServer } from "../../testing/testing.types.js";
import {
  PROVIDER_IDS,
  isCompatibleProvider,
  type ProviderId,
} from "./providers.types.js";
import { providerEndpoint } from "./provider-endpoint.js";

const endpointFor = (id: ProviderId) =>
  isCompatibleProvider(id)
    ? { baseUrl: "https://provider.example/proxy/v1" }
    : {};

let server: TestServer;
beforeAll(async () => {
  server = await startTestServer();
}, 60000);
afterAll(async () => {
  await server.close();
});
afterEach(() => jest.restoreAllMocks());

async function request(
  path: string,
  body?: unknown,
  user = "provider-user",
  method = "POST",
) {
  return fetch(server.baseUrl + "/api/v1" + path, {
    method,
    headers: {
      Authorization: `Bearer ${server.token(user)}`,
      "Content-Type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe("provider credentials and runtime", () => {
  it("DPAPI encrypts, roundtrips, rejects tampering and binds ciphertext to its owner/provider", async () => {
    const vault = new WindowsSecretProtector();
    const encrypted = await vault.protect(
      "fake-api-key-for-tests",
      "alice:openai",
    );
    expect(encrypted).not.toContain("fake-api-key");
    expect(await vault.unprotect(encrypted, "alice:openai")).toBe(
      "fake-api-key-for-tests",
    );
    await expect(vault.unprotect(encrypted, "bob:openai")).rejects.toThrow(
      "Credential vault",
    );
    await expect(vault.unprotect("corrupted", "alice:openai")).rejects.toThrow(
      "Credential vault",
    );
  }, 30000);

  it.each(PROVIDER_IDS)(
    "saves %s encrypted, returns redacted metadata and isolates users",
    async (id) => {
      const response = await request(`/providers/${id}`, {
        model: "test-model",
        apiKey: `fake-${id}-key`,
        ...endpointFor(id),
      });
      expect(response.status).toBe(201);
      const text = await response.text();
      expect(text).not.toContain(`fake-${id}-key`);
      expect(text).not.toContain("encrypted_key");
      const row = server.app
        .get(DatabaseService)
        .db.prepare(
          "SELECT encrypted_key FROM model_providers WHERE user_id = ? AND provider_id = ?",
        )
        .get("provider-user", id);
      expect(row?.["encrypted_key"]).not.toContain(`fake-${id}-key`);
      const other = await request(
        `/providers/${id}/models`,
        undefined,
        "another-user",
      );
      expect(other.status).toBe(404);
    },
    20000,
  );

  it("updates a model without returning or replacing the saved key", async () => {
    expect(
      (await request("/providers/openai", { model: "updated-model" })).status,
    ).toBe(201);
    const credentials = await server.app
      .get(ProvidersService)
      .credentials("provider-user", "openai");
    expect(credentials.apiKey).toBe("fake-openai-key");
    expect(credentials.model).toBe("updated-model");
  });

  it("rejects custom origins and invalid provider ids", async () => {
    expect(
      (await request("/providers/custom", { model: "x", apiKey: "test" }))
        .status,
    ).toBe(422);
    expect(
      (
        await request("/providers/openai", {
          model: "x",
          apiKey: "test",
          url: "http://evil.test",
        })
      ).status,
    ).toBe(400);
  });

  it.each(PROVIDER_IDS)(
    "tests %s and lists models without exposing credentials",
    async (id) => {
      const transport = server.app.get(ProviderTransport);
      const spy = jest
        .spyOn(transport, "models")
        .mockResolvedValue(["test-model"]);
      expect((await request(`/providers/${id}/test`)).status).toBe(201);
      const response = await request(`/providers/${id}/models`);
      expect(await response.json()).toEqual({ models: ["test-model"] });
      expect(spy).toHaveBeenCalled();
    },
  );

  it.each(PROVIDER_IDS)(
    "runs the configured %s through the existing SDK processor and SSE",
    async (id) => {
      const transport = server.app.get(ProviderTransport);
      const modelSpy = jest
        .spyOn(transport, "model")
        .mockResolvedValue(server.model);
      server.model.enqueue([assistantMessage(`Reply from ${id}`)]);
      expect((await request("/providers/active", { id })).status).toBe(201);
      const accepted = await request("/agent-runs", {
        projectId: `provider-${id}`,
        message: "Describe a cube",
        useConfiguredProvider: true,
      });
      expect(accepted.status).toBe(202);
      const body = (await accepted.json()) as {
        runId: string;
        eventsUrl: string;
      };
      const stream = openEventStream(
        server.baseUrl + body.eventsUrl,
        server.token("provider-user"),
      );
      const terminal = await stream.waitFor(
        (event) =>
          event.type === "run.completed" || event.type === "run.failed",
      );
      stream.stop();
      expect(terminal.envelope).toMatchObject({ type: "run.completed" });
      const run = await request(
        `/agent-runs/${body.runId}`,
        undefined,
        "provider-user",
        "GET",
      );
      expect(await run.json()).toMatchObject({
        status: "completed",
        finalOutput: `Reply from ${id}`,
      });
      expect(modelSpy.mock.calls[0]?.[0].id).toBe(id);
      if (isCompatibleProvider(id))
        expect(modelSpy.mock.calls[0]?.[0].baseUrl).toBe(
          "https://provider.example/proxy/v1",
        );
    },
  );

  it.each(["openai-compatible", "anthropic-compatible"] as const)(
    "preserves %s model-list paths, authentication and redirect policy",
    async (id) => {
      const fetchMock = jest
        .spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ data: [{ id: "model-a" }] }), {
            status: 200,
          }),
        );
      expect(
        await new ProviderTransport().models({
          id,
          apiKey: "fake-proxy-key",
          model: "model-a",
          baseUrl: "https://provider.example/prefix/v1/",
        }),
      ).toEqual(["model-a"]);
      const [url, options] = fetchMock.mock.calls[0] ?? [];
      expect(url).toBe(
        `https://provider.example/prefix/v1/models${id === "anthropic-compatible" ? "?limit=1000" : ""}`,
      );
      expect(options?.redirect).toBe("error");
      expect(options?.headers).toMatchObject(
        id === "openai-compatible"
          ? { Authorization: "Bearer fake-proxy-key" }
          : {
              "x-api-key": "fake-proxy-key",
              "anthropic-version": "2023-06-01",
            },
      );
    },
  );

  it("validates API prefixes and permits local inference endpoints", () => {
    expect(
      providerEndpoint("openai-compatible", "http://127.0.0.1:1234/v1/"),
    ).toBe("http://127.0.0.1:1234/v1");
    expect(
      providerEndpoint("anthropic-compatible", "http://[::1]:8000/v1"),
    ).toBe("http://[::1]:8000/v1");
    for (const url of [
      "http://remote.example/v1",
      "https://user:password@remote.example/v1",
      "https://remote.example/v1?key=secret",
      "file:///secret",
      "https://remote.example/v1#fragment",
    ])
      expect(() => providerEndpoint("openai-compatible", url)).toThrow();
    expect(() =>
      providerEndpoint("openai", "https://proxy.example/v1"),
    ).toThrow();
  });

  it("requires a new key before moving saved credentials to another endpoint", async () => {
    expect(
      (
        await request("/providers/openai-compatible", {
          model: "model-a",
          baseUrl: "https://other.example/v1",
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await request("/providers/openai-compatible/models", {
          baseUrl: "https://other.example/v1",
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await request("/providers/openai-compatible", {
          model: "model-a",
          apiKey: "new-fake-key",
          baseUrl: "https://other.example/v1/",
        })
      ).status,
    ).toBe(201);
    await expect(
      server.app
        .get(ProvidersService)
        .credentials(
          "provider-user",
          "openai-compatible",
          "model-a",
          "https://provider.example/proxy/v1",
        ),
    ).rejects.toThrow("endpoint changed");
  });

  it("uses Chat Completions for OpenAI-compatible model wrappers", async () => {
    const model = await new ProviderTransport().model({
      id: "openai-compatible",
      apiKey: "fake-key",
      model: "model-a",
      baseUrl: "http://localhost:1234/v1",
    });
    expect(model.constructor.name).toBe("OpenAIChatCompletionsModel");
  });

  it("never returns upstream errors or echoed keys", async () => {
    jest
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("secret: fake-openai-key"));
    await expect(
      new ProviderTransport().models({
        id: "openai",
        apiKey: "fake-openai-key",
        model: "x",
      }),
    ).rejects.toThrow("Could not load models");
  });
});
