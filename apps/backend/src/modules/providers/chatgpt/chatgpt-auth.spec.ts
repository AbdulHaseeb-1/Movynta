import { createHash } from "node:crypto";
import { jest } from "@jest/globals";
import { startTestServer } from "../../../testing/test-app.js";
import type { TestServer } from "../../../testing/testing.types.js";
import { DatabaseService } from "../../persistence/database.service.js";
import { ProvidersService } from "../providers.service.js";
import { reasoningEffortsFor, requiredModelSettings } from "../model-capabilities.js";
import { ChatgptAuthService } from "./chatgpt-auth.service.js";
import { ChatgptModelCatalog } from "./chatgpt-model-catalog.js";
import { ChatgptOAuthClient } from "./chatgpt-oauth.client.js";
import { CHATGPT_CALLBACK_PATH, CHATGPT_CALLBACK_PORT, CHATGPT_LOGIN_TTL_MS } from "./chatgpt.constants.js";
import { generatePkce } from "./chatgpt-pkce.js";
import { readTokenClaims } from "./chatgpt-token-claims.js";
import type { ChatgptSessionView, ChatgptTokens } from "./chatgpt.types.js";

function jwt(payload: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none" })}.${encode(payload)}.signature`;
}

const ID_TOKEN = jwt({
  email: "person@example.com",
  "https://api.openai.com/auth": { chatgpt_account_id: "acct_123", chatgpt_plan_type: "plus" },
});

function tokens(overrides: Partial<ChatgptTokens> = {}): ChatgptTokens {
  return {
    accessToken: "fake-access-token",
    refreshToken: "fake-refresh-token",
    idToken: ID_TOKEN,
    accountId: "acct_123",
    accessExpiresAt: Date.now() + 24 * 60 * 60 * 1000,
    ...overrides,
  };
}

describe("PKCE and token claims", () => {
  it("derives the S256 challenge from the verifier", () => {
    const { verifier, challenge } = generatePkce();
    expect(challenge).toBe(createHash("sha256").update(verifier).digest("base64url"));
    expect(generatePkce().verifier).not.toBe(verifier);
  });

  it("reads the account, plan and email from an id token", () => {
    expect(readTokenClaims(ID_TOKEN)).toMatchObject({
      accountId: "acct_123",
      plan: "plus",
      email: "person@example.com",
    });
    expect(readTokenClaims(jwt({ exp: 100 })).expiresAt).toBe(100000);
  });

  it("returns nothing for tokens it cannot read", () => {
    expect(readTokenClaims("not-a-jwt")).toMatchObject({ accountId: undefined, email: undefined });
    expect(readTokenClaims("a.@@@.c").accountId).toBeUndefined();
  });
});

describe("ChatGPT model settings", () => {
  it("never stores responses and offers only efforts the backend accepts", () => {
    expect(requiredModelSettings("chatgpt")).toMatchObject({ store: false });
    expect(requiredModelSettings("openai")).toEqual({});
    expect(reasoningEffortsFor("chatgpt", "gpt-5-codex")).toEqual(["low", "medium", "high"]);
    expect(reasoningEffortsFor("chatgpt", "gpt-5")).toEqual(["low", "medium", "high"]);
    expect(reasoningEffortsFor("chatgpt", "gpt-4o")).toEqual([]);
  });
});

describe("ChatGPT subscription sign-in", () => {
  let server: TestServer;
  let oauth: ChatgptOAuthClient;
  let catalog: ChatgptModelCatalog;
  const user = "chatgpt-user";

  beforeAll(async () => {
    server = await startTestServer();
    oauth = server.app.get(ChatgptOAuthClient);
    catalog = server.app.get(ChatgptModelCatalog);
  }, 60000);
  beforeEach(() => {
    jest.spyOn(catalog, "list").mockResolvedValue(["gpt-test", "gpt-test-mini"]);
  });
  afterAll(async () => {
    await server.close();
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await server.app.get(ChatgptAuthService).disconnect(user);
  });

  async function request(path: string, method = "GET", userId = user) {
    return fetch(`${server.baseUrl}/api/v1${path}`, {
      method,
      headers: { Authorization: `Bearer ${server.token(userId)}` },
    });
  }
  async function session(userId = user): Promise<ChatgptSessionView> {
    return (await (await request("/providers/chatgpt/session", "GET", userId)).json()) as ChatgptSessionView;
  }
  /** Starts a sign-in and plays the browser: the redirect arrives on the loopback callback. */
  async function signIn(): Promise<void> {
    const started = await request("/providers/chatgpt/login", "POST");
    expect(started.status).toBe(201);
    const { authorizationUrl } = (await started.json()) as { authorizationUrl: string };
    const state = new URL(authorizationUrl).searchParams.get("state") ?? "";
    const callback = `http://127.0.0.1:${CHATGPT_CALLBACK_PORT}${CHATGPT_CALLBACK_PATH}`;
    expect((await fetch(`${callback}?code=abc&state=wrong`)).status).toBe(400);
    expect((await fetch(`${callback}?code=abc&state=${state}`)).status).toBe(200);
    await expect(waitFor(async () => (await session()).state === "connected")).resolves.toBe(true);
  }
  async function waitFor(check: () => Promise<boolean>): Promise<boolean> {
    for (let attempt = 0; attempt < 50; attempt++) {
      if (await check()) return true;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return false;
  }

  it("builds a PKCE authorization URL for the registered redirect", async () => {
    const started = await (await request("/providers/chatgpt/login", "POST")).json() as { authorizationUrl: string };
    const url = new URL(started.authorizationUrl);
    expect(url.origin + url.pathname).toBe("https://auth.openai.com/oauth/authorize");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("redirect_uri")).toBe(
      `http://localhost:${CHATGPT_CALLBACK_PORT}${CHATGPT_CALLBACK_PATH}`,
    );
    expect((await session()).state).toBe("pending");
    const cancelled = await (await request("/providers/chatgpt/login", "DELETE")).json() as ChatgptSessionView;
    expect(cancelled.state).toBe("disconnected");
  });

  it("connects, activates the provider, and keeps tokens out of responses", async () => {
    const exchange = jest.spyOn(oauth, "exchangeCode").mockResolvedValue(tokens());
    await signIn();
    expect(exchange).toHaveBeenCalledWith("abc", expect.any(String));

    const body = await session();
    expect(body).toMatchObject({ state: "connected", email: "person@example.com", plan: "plus", error: null });
    const days = (Date.parse(body.expiresAt ?? "") - Date.parse(body.connectedAt ?? "")) / (24 * 60 * 60 * 1000);
    expect(days).toBeCloseTo(CHATGPT_LOGIN_TTL_MS / (24 * 60 * 60 * 1000), 3);
    expect(JSON.stringify(body)).not.toContain("fake-");

    const providers = (await (await request("/providers")).json()) as { id: string; configured: boolean; active: boolean }[];
    expect(providers.find((provider) => provider.id === "chatgpt")).toMatchObject({ configured: true, active: true });

    const stored = server.app.get(DatabaseService).db
      .prepare("SELECT encrypted_tokens FROM chatgpt_logins WHERE user_id = ?")
      .get(user);
    expect(stored?.["encrypted_tokens"]).not.toContain("fake-access-token");

    // The default model comes from the account's own list, never a built-in guess.
    expect(providers.find((provider) => provider.id === "chatgpt")).toMatchObject({ model: "gpt-test" });
    const credentials = await server.app.get(ProvidersService).credentials(user, "chatgpt");
    expect(credentials).toMatchObject({ apiKey: "fake-access-token", accountId: "acct_123", model: "gpt-test" });
    const models = await request("/providers/chatgpt/models", "POST");
    expect(models.status).toBe(201);
    expect(await models.json()).toEqual({ models: ["gpt-test", "gpt-test-mini"] });
  }, 20000);

  it("replaces a saved model the account no longer offers, but keeps an explicit pick", async () => {
    jest.spyOn(oauth, "exchangeCode").mockResolvedValue(tokens());
    await signIn();
    const providers = server.app.get(ProvidersService);
    await providers.save(user, "chatgpt", "gpt-5.1-codex", undefined);
    expect((await providers.credentials(user, "chatgpt", "gpt-5.1-codex")).model).toBe("gpt-test");
    expect(providers.list(user).find((item) => item.id === "chatgpt")?.model).toBe("gpt-test");
    expect((await providers.credentials(user, "chatgpt", "gpt-hidden")).model).toBe("gpt-hidden");
    expect((await providers.credentials(user, "chatgpt", "gpt-test-mini")).model).toBe("gpt-test-mini");
  }, 20000);

  it("isolates sign-ins between users", async () => {
    jest.spyOn(oauth, "exchangeCode").mockResolvedValue(tokens());
    await signIn();
    expect((await session("someone-else")).state).toBe("disconnected");
    expect((await request("/providers/chatgpt/models", "POST", "someone-else")).status).toBe(404);
  }, 20000);

  it("reports a failed token exchange once", async () => {
    jest.spyOn(oauth, "exchangeCode").mockRejectedValue(new Error("boom"));
    const started = (await (await request("/providers/chatgpt/login", "POST")).json()) as { authorizationUrl: string };
    const state = new URL(started.authorizationUrl).searchParams.get("state") ?? "";
    await fetch(`http://127.0.0.1:${CHATGPT_CALLBACK_PORT}${CHATGPT_CALLBACK_PATH}?code=abc&state=${state}`);
    const service = server.app.get(ChatgptAuthService);
    await waitFor(async () => !service["pending"].has(user));
    const first = await session();
    expect(first).toMatchObject({ state: "disconnected", error: "The ChatGPT sign-in failed." });
    expect((await session()).error).toBeNull();
  }, 20000);

  it("expires the sign-in after 30 days and wipes its tokens", async () => {
    jest.spyOn(oauth, "exchangeCode").mockResolvedValue(tokens());
    await signIn();
    server.app.get(DatabaseService).db
      .prepare("UPDATE chatgpt_logins SET expires_at = ? WHERE user_id = ?")
      .run(new Date(Date.now() - 1000).toISOString(), user);

    expect((await session()).state).toBe("expired");
    const providers = (await (await request("/providers")).json()) as { id: string; configured: boolean; active: boolean }[];
    expect(providers.find((provider) => provider.id === "chatgpt")).toMatchObject({ configured: false, active: false });
    await expect(server.app.get(ProvidersService).credentials(user, "chatgpt")).rejects.toThrow("expired");
    const row = server.app.get(DatabaseService).db
      .prepare("SELECT encrypted_tokens FROM chatgpt_logins WHERE user_id = ?")
      .get(user);
    expect(row?.["encrypted_tokens"]).toBe("");
  }, 20000);

  it("refreshes a near-expiry access token once for concurrent callers", async () => {
    jest.spyOn(oauth, "exchangeCode").mockResolvedValue(tokens({ accessExpiresAt: Date.now() + 1000 }));
    const refresh = jest
      .spyOn(oauth, "refresh")
      .mockResolvedValue(tokens({ accessToken: "fake-new-access", refreshToken: "fake-new-refresh" }));
    await signIn();
    const service = server.app.get(ChatgptAuthService);
    const [a, b] = await Promise.all([service.credentials(user), service.credentials(user)]);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(a.accessToken).toBe("fake-new-access");
    expect(b.accessToken).toBe("fake-new-access");
    // The rotated refresh token is the one used next time, and the 30-day window is unchanged.
    expect((await service.credentials(user)).accessToken).toBe("fake-new-access");
    expect(refresh).toHaveBeenCalledTimes(1);
  }, 20000);

  it("signs out when the provider is removed", async () => {
    jest.spyOn(oauth, "exchangeCode").mockResolvedValue(tokens());
    await signIn();
    expect((await request("/providers/chatgpt", "DELETE")).status).toBe(200);
    expect((await session()).state).toBe("disconnected");
    const row = server.app.get(DatabaseService).db
      .prepare("SELECT 1 AS found FROM model_providers WHERE user_id = ? AND provider_id = 'chatgpt'")
      .get(user);
    expect(row).toBeUndefined();
  }, 20000);

  it("lists only visible models, best first, for the signed-in account", async () => {
    jest.restoreAllMocks();
    const auth = server.app.get(ChatgptAuthService);
    jest.spyOn(auth, "credentials").mockResolvedValue({ accessToken: "fake-access-token", accountId: "acct_catalog" });
    const fetchMock = jest.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          models: [
            { slug: "hidden", visibility: "hide", priority: 1 },
            { slug: "second", visibility: "list", priority: 9 },
            { slug: "first", visibility: "list", priority: 5 },
          ],
        }),
        { status: 200 },
      ),
    );
    const fresh = new ChatgptModelCatalog(auth);
    expect(await fresh.list(user)).toEqual(["first", "second"]);
    await fresh.list(user);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toContain("/backend-api/codex/models?client_version=");
    expect(JSON.stringify(init)).toContain("acct_catalog");
  });
});
