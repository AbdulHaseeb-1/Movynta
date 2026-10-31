import { Module } from "@nestjs/common";
import { McpRegistry } from "./mcp.registry.js";

@Module({
  providers: [McpRegistry],
  exports: [McpRegistry],
})
export class McpModule {}
