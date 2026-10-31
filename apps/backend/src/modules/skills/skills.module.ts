import { Module } from "@nestjs/common";
import { SkillsController } from "./skills.controller.js";
import { SkillsLoader } from "./skills.loader.js";
import { SkillsRegistry } from "./skills.registry.js";

@Module({
  controllers: [SkillsController],
  providers: [SkillsLoader, SkillsRegistry],
  exports: [SkillsRegistry],
})
export class SkillsModule {}
