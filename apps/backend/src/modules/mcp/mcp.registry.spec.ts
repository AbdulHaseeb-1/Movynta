import { loadAppConfig } from "../../config/configuration.js";
import { TEST_AUTH_SECRET } from "../../testing/constants.js";
import { McpRegistry } from "./mcp.registry.js";

/** An operator configured two servers; their tools differ from the defaults. */
const SERVERS_JSON =
  '[{"name":"local-tools","command":"node","args":["s.js"],"allowedTools":["read_file"]},' +
  '{"name":"other","command":"node","args":["o.js"],"allowedTools":[]}]';

function registry(mcpEnabled: boolean): McpRegistry {
  const config = loadAppConfig({
    NODE_ENV: "test",
    AUTH_SECRET: TEST_AUTH_SECRET,
    DATABASE_URL: ":memory:",
    AGENTS_ENABLED: "false",
    MCP_ENABLED: mcpEnabled ? "true" : "false",
    MCP_SERVERS_JSON: SERVERS_JSON,
  });
  return new McpRegistry(config);
}

describe("McpRegistry", () => {
  it("lists configured servers even while MCP is off", () => {
    expect(registry(false).list()).toEqual([
      { name: "local-tools", state: "disabled", allowedTools: ["read_file"] },
      { name: "other", state: "disabled", allowedTools: [] },
    ]);
  });

  it("marks servers configured when MCP is on", () => {
    expect(registry(true).list().every((server) => server.state === "configured")).toBe(true);
  });

  it("resolves a server only while MCP is on", () => {
    expect(registry(false).server("local-tools")).toBeUndefined();
    const server = registry(true).server("local-tools");
    expect(server?.allowedTools).toEqual(["read_file"]);
  });

  it("resolves another server by name", () => {
    expect(registry(true).server("nope")).toBeUndefined();
  });

  it("denies tools when MCP is off, even if the server allowlists them", () => {
    expect(registry(false).isToolAllowed("local-tools", "read_file")).toBe(false);
  });

  it("allows only allowlisted tools of known servers", () => {
    const enabled = registry(true);
    expect(enabled.isToolAllowed("local-tools", "read_file")).toBe(true);
    expect(enabled.isToolAllowed("local-tools", "write_file")).toBe(false);
    expect(enabled.isToolAllowed("other", "read_file")).toBe(false);
    expect(enabled.isToolAllowed("nope", "read_file")).toBe(false);
  });
});
