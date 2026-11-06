import { Module } from "@nestjs/common";
import { ProjectsModule } from "../projects/projects.module.js";
import { ProjectsService } from "../projects/projects.service.js";
import { EDITOR_BRIDGE } from "../editor-bridge/editor-bridge.tokens.js";
import type { EditorBridge } from "../editor-bridge/editor-bridge.types.js";
import { EditorBridgeModule } from "../editor-bridge/editor-bridge.module.js";
import { CommandProposalService } from "../editor-bridge/proposals/command-proposal.service.js";
import { SkillsModule } from "../skills/skills.module.js";
import { SkillsRegistry } from "../skills/skills.registry.js";
import { createEditorTools } from "./editor/editor.tools.js";
import { createModelingTools, MODELING_PLAN_TOOL_NAME } from "./modeling/modeling.tools.js";
import { createQualityTools } from "./modeling/quality.tools.js";
import { createSkillTools } from "./skills/skills.tools.js";
import { createProceduralTools } from "./procedural/index.js";
import { ToolRegistry } from "./tool.registry.js";
import { TOOL_DEFINITIONS } from "./tool.tokens.js";
import type { ToolDefinition } from "./tool.types.js";
import { createValidationTools } from "./validation/validation.tools.js";
import { createViewportTools } from "./viewport/index.js";

@Module({
  imports: [EditorBridgeModule, SkillsModule, ProjectsModule],
  providers: [
    {
      provide: TOOL_DEFINITIONS,
      inject: [EDITOR_BRIDGE, CommandProposalService, SkillsRegistry, ProjectsService],
      useFactory: (bridge: EditorBridge, proposals: CommandProposalService, skills: SkillsRegistry, projects: ProjectsService): ToolDefinition[] => {
        const editorTools = createEditorTools({ bridge, proposals, getUnits: (userId, projectId) => projects.measurements(userId, projectId).value.units });
        const validationTools = createValidationTools({ bridge });
        const skillTools = createSkillTools({ skills });
        const proceduralTools = createProceduralTools({ bridge, proposals });
        const viewportTools = createViewportTools({ bridge, proposals });
        const qualityTools = createQualityTools(bridge);
        const knownToolNames = [
          ...editorTools,
          ...validationTools,
          ...skillTools,
          ...proceduralTools,
          ...viewportTools,
          ...qualityTools,
        ].map((definition) => definition.name);
        const modelingTools = createModelingTools({
          knownToolNames: [...knownToolNames, MODELING_PLAN_TOOL_NAME],
        });
        return [...editorTools, ...validationTools, ...skillTools, ...proceduralTools, ...viewportTools, ...qualityTools, ...modelingTools];
      },
    },
    ToolRegistry,
  ],
  exports: [ToolRegistry],
})
export class ToolsModule {}
