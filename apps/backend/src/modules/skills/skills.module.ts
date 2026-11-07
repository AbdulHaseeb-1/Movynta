import { Module } from "@nestjs/common";
import { SkillsController } from "./skills.controller.js";
import { SkillsLoader } from "./skills.loader.js";
import { SkillsRegistry } from "./skills.registry.js";

/** The skills feature: the loader and the registry of SKILL.md files. */
@Module({
  controllers: [SkillsController],
  providers: [SkillsLoader, SkillsRegistry],
  exports: [SkillsRegistry],
})
export class SkillsModule {}
