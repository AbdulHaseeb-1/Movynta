import { jest } from "@jest/globals";
import { startTestServer } from "../../testing/test-app.js";
import type { TestServer } from "../../testing/testing.types.js";
import type { SecretProtector } from "./secret-protector.js";

/** Keys are not under test here, so the vault stores them as they are. */
const memoryVault: SecretProtector = {
  protect: (value) => Promise.resolve(value),
  unprotect: (value) => Promise.resolve(value),
};

interface ProviderRow {
  readonly id: string;
  readonly configured: boolean;
  readonly acceptsImages: boolean;
}

let server: TestServer;

beforeAll(async () => {
  server = await startTestServer(0, { secretProtector: memoryVault });
}, 60_000);

afterAll(async () => {
  await server.close();
});

afterEach(() => jest.restoreAllMocks());

async function call(method: string, path: string, body?: unknown): Promise<Response> {
  return fetch(server.baseUrl + "/api/v1" + path, {
    method,
    headers: {
      Authorization: `Bearer ${server.token("picture-user")}`,
      "Content-Type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function providerRows(): Promise<Map<string, ProviderRow>> {
  const response = await call("GET", "/providers");
  const rows = (await response.json()) as ProviderRow[];
  return new Map(rows.map((row) => [row.id, row]));
}

const endpoint = { baseUrl: "https://provider.example/proxy/v1", model: "vision-model", apiKey: "test-key" };

describe("picture setting for compatible endpoints", () => {
  it("offers pictures by default, for every provider", async () => {
    const rows = await providerRows();
    expect(rows.get("openai-compatible")?.acceptsImages).toBe(true);
    expect(rows.get("anthropic")?.acceptsImages).toBe(true);
  });

  it("stores the choice of a compatible endpoint, and keeps it when the endpoint is saved again without one", async () => {
    const saved = await call("POST", "/providers/openai-compatible", { ...endpoint, acceptsImages: false });
    expect(saved.status).toBe(201);
    expect((await providerRows()).get("openai-compatible")?.acceptsImages).toBe(false);

    const again = await call("POST", "/providers/openai-compatible", { model: "vision-model", baseUrl: endpoint.baseUrl });
    expect(again.status).toBe(201);
    expect((await providerRows()).get("openai-compatible")?.acceptsImages).toBe(false);

    const turnedOn = await call("POST", "/providers/openai-compatible", { model: "vision-model", baseUrl: endpoint.baseUrl, acceptsImages: true });
    expect(turnedOn.status).toBe(201);
    expect((await providerRows()).get("openai-compatible")?.acceptsImages).toBe(true);
  });

  it("ignores the choice for native providers, which always receive pictures", async () => {
    const saved = await call("POST", "/providers/anthropic", { model: "claude-sonnet-5-5", apiKey: "test-key", acceptsImages: false });
    expect(saved.status).toBe(201);
    expect((await providerRows()).get("anthropic")?.acceptsImages).toBe(true);
  });

  it("rejects a choice that is not a boolean", async () => {
    const response = await call("POST", "/providers/anthropic-compatible", { ...endpoint, acceptsImages: "no" });
    expect(response.status).toBe(400);
  });
});
