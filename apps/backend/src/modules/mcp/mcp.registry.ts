import { Inject, Injectable } from "@nestjs/common";
import { APP_CONFIG } from "../../config/config.module.js";
import type { AppConfig, McpServerConfig } from "../../config/config.types.js";
import type { McpServerStatus } from "./mcp.types.js";

/**
 * Registry of MCP servers the operator explicitly configured. Nothing is
 * connected automatically, and tools are denied unless listed in `allowedTools`.
 */
@Injectable()
export class McpRegistry {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  list(): McpServerStatus[] {
    const state = this.config.mcp.enabled ? "configured" : "disabled";
    return this.config.mcp.servers.map((server) => ({ name: server.name, state, allowedTools: server.allowedTools }));
  }

  server(name: string): McpServerConfig | undefined {
    if (!this.config.mcp.enabled) return undefined;
    return this.config.mcp.servers.find((server) => server.name === name);
  }

  /** Default-deny: a tool is usable only when its server is enabled and the tool is allowlisted. */
  isToolAllowed(serverName: string, toolName: string): boolean {
    return this.server(serverName)?.allowedTools.includes(toolName) ?? false;
  }
}
