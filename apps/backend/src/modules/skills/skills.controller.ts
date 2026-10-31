import { Controller, Get, Param } from "@nestjs/common";
import { ApiBearerAuth, ApiNotFoundResponse, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { NotFoundError } from "../../common/errors/app-error.js";
import { SkillsRegistry } from "./skills.registry.js";
import type { SkillManifest, SkillSummary } from "./skills.types.js";

@ApiTags("skills")
@ApiBearerAuth()
@Controller({ path: "skills", version: "1" })
export class SkillsController {
  constructor(private readonly skills: SkillsRegistry) {}

  @Get()
  @ApiOkResponse({ description: "Metadata for every registered skill." })
  list(): SkillSummary[] {
    return this.skills.list();
  }

  @Get(":skillId")
  @ApiOkResponse({ description: "Skill metadata and workflow instructions." })
  @ApiNotFoundResponse({ description: "Unknown skill id." })
  get(@Param("skillId") skillId: string): SkillManifest {
    const skill = this.skills.get(skillId);
    if (!skill) throw new NotFoundError("Skill not found");
    return skill;
  }
}
