import { jest } from "@jest/globals";
import { startTestServer } from "../../../testing/test-app.js";
import type { TestServer } from "../../../testing/testing.types.js";
import type { SecretProtector } from "../secret-protector.js";
import { ChatgptAuthService } from "./chatgpt-auth.service.js";
import { ChatgptLoginRepository } from "./chatgpt-login.repository.js";
import { ChatgptOAuthClient } from "./chatgpt-oauth.client.js";
import { ChatgptSignInRequiredError } from "./chatgpt.errors.js";
import { CHATGPT_LOGIN_TTL_MS } from "./chatgpt.constants.js";
import type { ChatgptTokens } from "./chatgpt.types.js";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A vault that works on any platform, with a pause on chosen reads so callers can be made to overlap. */
class SlowVault implements SecretProtector {
  delays: number[] = [];
  protect(value: string): Promise<string> {
    return Promise.resolve(Buffer.from(value).toString("base64"));
  }
  async unprotect(value: string): Promise<string> {
    const delay = this.delays.shift() ?? 0;
    if (delay > 0) await wait(delay);
    return Buffer.from(value, "base64").toString("utf8");
  }
}

describe("ChatGPT token refresh when callers overlap", () => {
  const vault = new SlowVault();
  const user = "refresh-user";
  let server: TestServer;

  beforeAll(async () => {
    server = await startTestServer(0, { secretProtector: vault });
  }, 60000);
  afterAll(async () => {
    await server.close();
  });
  afterEach(() => jest.restoreAllMocks());

  const nearExpiry: ChatgptTokens = {
    accessToken: "old-access",
    refreshToken: "old-refresh",
    idToken: "a.b.c",
    accountId: "acct_1",
    accessExpiresAt: Date.now() + 1000,
  };
  const rotated: ChatgptTokens = { ...nearExpiry, accessToken: "new-access", refreshToken: "new-refresh", accessExpiresAt: Date.now() + 86_400_000 };

  async function seed(): Promise<void> {
    const now = Date.now();
    server.app.get(ChatgptLoginRepository).upsert(user, {
      encryptedTokens: await vault.protect(JSON.stringify(nearExpiry)),
      email: null, plan: null,
      connectedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + CHATGPT_LOGIN_TTL_MS).toISOString(),
    } as never);
  }

  it("does not spend a rotated refresh token twice, which would sign the user out", async () => {
    await seed();
    const oauth = server.app.get(ChatgptOAuthClient);
    // The first refresh rotates the token; using the old refresh token again is refused.
    const refresh = jest.spyOn(oauth, "refresh").mockImplementation(async (tokens) => {
      await wait(20);
      if (tokens.refreshToken !== "old-refresh") throw new ChatgptSignInRequiredError("refresh token already used");
      return rotated;
    });
    const service = server.app.get(ChatgptAuthService);
    // Caller B reads the stored tokens slowly, so it checks for a running refresh only after caller A has finished.
    vault.delays = [0, 300];
    const [a, b] = await Promise.all([service.credentials(user), service.credentials(user)]);
    expect(a.accessToken).toBe("new-access");
    expect(b.accessToken).toBe("new-access");
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(service.isConnected(user)).toBe(true);
  }, 20000);
});
