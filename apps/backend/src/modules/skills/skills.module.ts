import { Module } from "@nestjs/common";
import { SkillsController } from "./skills.controller.js";
import { SkillsLoader } from "./skills.loader.js";
import { SkillsRegistry } from "./skills.registry.js";

@Module({
  controllers: [SkillsController],
  providers: [SkillsLoader, SkillsRegistry],
  exports: [SkillsRegistry],
/** The skills feature: the loader and the registry of SKILL.md files. */
})
export class SkillsModule {}
