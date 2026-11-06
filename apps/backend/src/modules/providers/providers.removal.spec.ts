import { startTestServer } from "../../testing/test-app.js";
import type { TestServer } from "../../testing/testing.types.js";
import type { SecretProtector } from "./secret-protector.js";
import { ProvidersService } from "./providers.service.js";

/** Works on any platform, so these checks do not depend on Windows credential storage. */
const vault: SecretProtector = {
  protect: (value) => Promise.resolve(Buffer.from(value).toString("base64")),
  unprotect: (value) => Promise.resolve(Buffer.from(value, "base64").toString("utf8")),
};

describe("removing a provider", () => {
  let server: TestServer;
  beforeAll(async () => {
    server = await startTestServer(0, { secretProtector: vault });
  }, 60000);
  afterAll(async () => {
    await server.close();
  });

  it("selects another configured provider when the selected one is removed", async () => {
    const providers = server.app.get(ProvidersService);
    await providers.save("remover", "openai", "model-a", "sk-a");
    await providers.save("remover", "anthropic", "model-b", "sk-b");
    expect(providers.active("remover").id).toBe("openai");

    const after = await providers.remove("remover", "openai");
    expect(after.find((provider) => provider.id === "openai")?.configured).toBe(false);
    expect(providers.active("remover").id).toBe("anthropic");
  });

  it("keeps the selection when a provider that is not selected is removed", async () => {
    const providers = server.app.get(ProvidersService);
    await providers.save("keeper", "openai", "model-a", "sk-a");
    await providers.save("keeper", "anthropic", "model-b", "sk-b");
    await providers.remove("keeper", "anthropic");
    expect(providers.active("keeper").id).toBe("openai");
  });

  it("leaves nothing selected when the last provider is removed", async () => {
    const providers = server.app.get(ProvidersService);
    await providers.save("last", "openai", "model-a", "sk-a");
    const after = await providers.remove("last", "openai");
    expect(after.some((provider) => provider.active)).toBe(false);
    expect(() => providers.active("last")).toThrow();
  });
});
