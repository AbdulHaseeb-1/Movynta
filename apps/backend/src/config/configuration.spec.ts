import { loadAppConfig } from "./configuration.js";

const validEnv = { NODE_ENV: "test", AUTH_SECRET: "x".repeat(32), AGENTS_ENABLED: "false" };

describe("loadAppConfig", () => {
  it("rejects a short auth secret with a readable message", () => {
    expect(() => loadAppConfig({ ...validEnv, AUTH_SECRET: "short" })).toThrow(/AUTH_SECRET/);
  });

  it("requires the OpenAI key and model outside tests when agents are enabled", () => {
    expect(() => loadAppConfig({ NODE_ENV: "production", AUTH_SECRET: "x".repeat(32), AGENTS_ENABLED: "true" })).toThrow(
      /OPENAI_API_KEY/,
    );
  });

  it("does not require the OpenAI key when agents are disabled", () => {
    expect(loadAppConfig(validEnv).agents.enabled).toBe(false);
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
