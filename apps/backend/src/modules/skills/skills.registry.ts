import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { APP_CONFIG } from "../../config/config.module.js";
import type { AppConfig } from "../../config/configuration.js";
import type { ModelingDimension } from "../../shared/schemas/modeling-plan.schema.js";
import { SkillsLoader } from "./skills.loader.js";
import { toSkillSummary, type SkillManifest, type SkillSummary } from "./skills.types.js";

export interface SkillRequest {
  readonly message: string;
  readonly dimension?: ModelingDimension | undefined;
}

const MAX_SELECTED_SKILLS = 2;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Holds validated skills and selects only the ones relevant to a request. */
@Injectable()
export class SkillsRegistry implements OnModuleInit {
  private readonly logger = new Logger(SkillsRegistry.name);
  private readonly skills = new Map<string, SkillManifest>();

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly loader: SkillsLoader,
  ) {}

  onModuleInit(): void {
    this.registerAll(this.loader.load(this.config.skills.directory));
    this.logger.log(`loaded ${this.skills.size} skill(s)`);
  }

  registerAll(manifests: readonly SkillManifest[]): void {
    this.skills.clear();
    for (const manifest of manifests) {
      if (this.skills.has(manifest.id)) throw new Error(`Duplicate skill id "${manifest.id}"`);
      this.skills.set(manifest.id, manifest);
    }
  }

  list(): SkillSummary[] {
    return [...this.skills.values()].map(toSkillSummary);
  }

  get(skillId: string): SkillManifest | undefined {
    return this.skills.get(skillId);
  }

  all(): SkillManifest[] {
    return [...this.skills.values()];
  }

  /**
   * Scores skills by dimension and tag matches in the request, returning at most
   * two. Skills that do not match are never loaded into the prompt.
   */
  selectRelevant(request: SkillRequest): SkillSummary[] {
    const message = request.message.toLowerCase();
    const scored = [...this.skills.values()]
      .map((skill) => {
        const dimensionScore = request.dimension !== undefined && skill.dimensions.includes(request.dimension) ? 2 : 0;
        const tagScore = skill.tags.filter((tag) =>
          new RegExp(`\\b${escapeRegExp(tag.toLowerCase())}\\b`).test(message),
        ).length;
        return { skill, score: dimensionScore + tagScore };
      })
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || a.skill.id.localeCompare(b.skill.id));

    return scored.slice(0, MAX_SELECTED_SKILLS).map((entry) => toSkillSummary(entry.skill));
  }
}
