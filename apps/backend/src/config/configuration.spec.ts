import { loadAppConfig } from "./configuration.js";

const validEnv = { NODE_ENV: "test", AUTH_SECRET: "x".repeat(32), AGENTS_ENABLED: "false" };

describe("loadAppConfig", () => {
  it("allows long modeling runs by default while honoring configured timeouts", () => {
    expect(loadAppConfig(validEnv).agents).toMatchObject({ runTimeoutMs: 7_200_000, runIdleTimeoutMs: 300_000 });
    expect(loadAppConfig({ ...validEnv, AGENT_RUN_TIMEOUT_MS: "60000" }).agents.runTimeoutMs).toBe(60_000);
  });

  it("rejects a short auth secret with a readable message", () => {
    expect(() => loadAppConfig({ ...validEnv, AUTH_SECRET: "short" })).toThrow(/AUTH_SECRET/);
  });

  it("starts without environment provider keys so providers can be configured securely later", () => {
    expect(loadAppConfig({ NODE_ENV: "production", AUTH_SECRET: "x".repeat(32), AGENTS_ENABLED: "true" }).agents.apiKey).toBeUndefined();
  });

  it("does not require the OpenAI key when agents are disabled", () => {
    expect(loadAppConfig(validEnv).agents.enabled).toBe(false);
  });

  it("reviews only requests that ask for quality by default, and reads the review settings", () => {
    expect(loadAppConfig(validEnv).agents).toMatchObject({ reviewMode: "quality", reviewLimit: 2, reviewMaxTurns: 40 });
    expect(loadAppConfig({ ...validEnv, AGENT_REVIEW_MODE: "builds", AGENT_REVIEW_LIMIT: "3", AGENT_REVIEW_MAX_TURNS: "10" }).agents).toMatchObject({ reviewMode: "builds", reviewLimit: 3, reviewMaxTurns: 10 });
    expect(loadAppConfig({ ...validEnv, AGENT_REVIEW_MODE: "off" }).agents.reviewMode).toBe("off");
    expect(() => loadAppConfig({ ...validEnv, AGENT_REVIEW_MODE: "sometimes" })).toThrow(/AGENT_REVIEW_MODE/);
  });

  it("maps file database urls to paths and accepts :memory:", () => {
    expect(loadAppConfig({ ...validEnv, DATABASE_URL: "file:./data/x.sqlite" }).database.path).toBe("./data/x.sqlite");
    expect(loadAppConfig({ ...validEnv, DATABASE_URL: ":memory:" }).database.path).toBe(":memory:");
  });

  it("rejects database urls with other schemes", () => {
    expect(() => loadAppConfig({ ...validEnv, DATABASE_URL: "postgres://localhost/db" })).toThrow(/DATABASE_URL/);
  });

  it("binds to localhost and keeps MCP and Blender off by default", () => {
    const config = loadAppConfig(validEnv);
    expect(config.host).toBe("127.0.0.1");
    expect(config.mcp.enabled).toBe(false);
    expect(config.mcp.servers).toEqual([]);
    expect(config.blender.enabled).toBe(false);
  });

  it("parses comma-separated CORS origins", () => {
    const config = loadAppConfig({ ...validEnv, CORS_ORIGINS: "http://a.test, http://b.test" });
    expect(config.corsOrigins).toEqual(["http://a.test", "http://b.test"]);
  });

  it("validates MCP server JSON when MCP is configured", () => {
    const config = loadAppConfig({
      ...validEnv,
      MCP_ENABLED: "true",
      MCP_SERVERS_JSON: '[{"name":"local-tools","command":"node","args":["s.js"],"allowedTools":["read_file"]}]',
    });
    expect(config.mcp.servers[0]?.allowedTools).toEqual(["read_file"]);
    expect(() => loadAppConfig({ ...validEnv, MCP_SERVERS_JSON: '[{"name":"Bad Name","command":"x"}]' })).toThrow();
  });
});
