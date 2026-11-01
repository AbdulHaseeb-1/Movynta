import { Controller, Get } from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { TOOLSETS } from "./catalog/index.js";
import { ToolRegistry } from "./tool.registry.js";
import type { ToolCatalogView } from "./tool.types.js";

/** Read-only view of what agents can call. Handlers and secrets are never exposed. */
@ApiTags("tools")
@ApiBearerAuth()
@Controller({ path: "tools", version: "1" })
export class ToolsController {
  constructor(private readonly registry: ToolRegistry) {}

  @Get()
  @ApiOkResponse({ description: "Every registered tool with its JSON Schema, and the toolsets that group them." })
  catalog(): ToolCatalogView {
    return { tools: this.registry.describe(), toolsets: TOOLSETS };
  }
}
