import { Module } from "@nestjs/common";
import { McpRegistry } from "./mcp.registry.js";

@Module({
  providers: [McpRegistry],
  exports: [McpRegistry],
/** The MCP server registry. It is off by default, and its tools are denied unless allowed. */
})
export class McpModule {}
