import { Module } from "@nestjs/common";
import { McpRegistry } from "./mcp.registry.js";

/** The MCP server registry. It is off by default, and its tools are denied unless allowed. */
@Module({
  providers: [McpRegistry],
  exports: [McpRegistry],
})
export class McpModule {}
