import { Module } from "@nestjs/common";
import { EDITOR_BRIDGE, type EditorBridge } from "../editor-bridge/editor-bridge.interface.js";
import { EditorBridgeModule } from "../editor-bridge/editor-bridge.module.js";
import { CommandProposalService } from "../editor-bridge/proposals/command-proposal.service.js";
import { SkillsModule } from "../skills/skills.module.js";
import { SkillsRegistry } from "../skills/skills.registry.js";
import { createEditorTools } from "./editor/editor.tools.js";
import { createModelingTools, MODELING_PLAN_TOOL_NAME } from "./modeling/modeling.tools.js";
import { createSkillTools } from "./skills/skills.tools.js";
import { ToolRegistry } from "./tool.registry.js";
import { TOOL_DEFINITIONS } from "./tool.tokens.js";
import type { ToolDefinition } from "./tool.types.js";
import { createValidationTools } from "./validation/validation.tools.js";

@Module({
  imports: [EditorBridgeModule, SkillsModule],
  providers: [
    {
      provide: TOOL_DEFINITIONS,
      inject: [EDITOR_BRIDGE, CommandProposalService, SkillsRegistry],
      useFactory: (bridge: EditorBridge, proposals: CommandProposalService, skills: SkillsRegistry): ToolDefinition[] => {
        const editorTools = createEditorTools({ bridge, proposals });
        const validationTools = createValidationTools({ bridge });
        const skillTools = createSkillTools({ skills });
        const knownToolNames = [
          ...editorTools,
          ...validationTools,
          ...skillTools,
        ].map((definition) => definition.name);
        const modelingTools = createModelingTools({
          knownToolNames: [...knownToolNames, MODELING_PLAN_TOOL_NAME],
        });
        return [...editorTools, ...validationTools, ...skillTools, ...modelingTools];
      },
    },
    ToolRegistry,
  ],
  exports: [ToolRegistry],
})
export class ToolsModule {}
