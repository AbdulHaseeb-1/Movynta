import { Module } from "@nestjs/common";
import { EDITOR_BRIDGE } from "../editor-bridge/editor-bridge.tokens.js";
import type { EditorBridge } from "../editor-bridge/editor-bridge.types.js";
import { EditorBridgeModule } from "../editor-bridge/editor-bridge.module.js";
import { CommandProposalService } from "../editor-bridge/proposals/command-proposal.service.js";
import { SkillsModule } from "../skills/skills.module.js";
import { SkillsRegistry } from "../skills/skills.registry.js";
import { createEditorTools } from "./editor/editor.tools.js";
import { createModelingTools } from "./modeling/modeling.tools.js";
import { createSkillTools } from "./skills/skills.tools.js";
import { ToolRegistry } from "./tool.registry.js";
import { TOOL_DEFINITIONS } from "./tool.tokens.js";
import { ToolsController } from "./tools.controller.js";
import type { ToolDefinition } from "./tool.types.js";
import { createValidationTools } from "./validation/validation.tools.js";

/**
 * Composition root for tools. Each feature folder contributes a factory; the
 * registry then checks the result against `catalog/tool-names.ts`, so adding a
 * tool means: write the factory, add its name to the catalog, add it to the toolsets that need it.
 */
@Module({
  imports: [EditorBridgeModule, SkillsModule],
  controllers: [ToolsController],
  providers: [
    {
      provide: TOOL_DEFINITIONS,
      inject: [EDITOR_BRIDGE, CommandProposalService, SkillsRegistry],
      useFactory: (bridge: EditorBridge, proposals: CommandProposalService, skills: SkillsRegistry): ToolDefinition[] => [
        ...createEditorTools({ bridge, proposals }),
        ...createValidationTools({ bridge }),
        ...createSkillTools({ skills }),
        ...createModelingTools(),
      ],
    },
    ToolRegistry,
  ],
  exports: [ToolRegistry],
})
export class ToolsModule {}
