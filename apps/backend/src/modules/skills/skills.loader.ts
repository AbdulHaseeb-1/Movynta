import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { parseSkillDocument } from "./skill-document.parser.js";
import type { SkillManifest } from "./skills.types.js";

/** The name of the file that holds a skill. */
export const SKILL_FILE_NAME = "SKILL.md";
/** Ids may contain dots (e.g. `hero.v2`) but never `..`, so they cannot escape the root. */
export const SKILL_ID_PATTERN = /^[a-z0-9][a-z0-9.-]{1,63}$/;
/** Whether an id is a safe skill folder name: no path separators and no parent-directory parts. */
export function isValidSkillId(id: string): boolean {
  return SKILL_ID_PATTERN.test(id) && !id.includes("..");
}
/** The largest skill file the loader reads, in bytes. */
export const MAX_SKILL_FILE_BYTES = 64 * 1024;

/**
 * Reads skills from a root directory. Each skill is `<root>/<id>/SKILL.md`.
 * Only that exact file is read; folder names are validated, and resolved paths
 * must stay inside the root (blocking `..` and symlink escapes).
 */
export class SkillsLoader {
  load(rootDirectory: string): SkillManifest[] {
    const root = realpathSync(rootDirectory);
    const skills: SkillManifest[] = [];
    const seen = new Set<string>();

    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (!isValidSkillId(entry.name)) {
        throw new Error(`Invalid skill folder name "${entry.name}"`);
      }

      const manifest = this.readSkill(root, entry.name);
      if (seen.has(manifest.id)) throw new Error(`Duplicate skill id "${manifest.id}"`);
      seen.add(manifest.id);
      skills.push(manifest);
    }

    return skills.sort((a, b) => a.id.localeCompare(b.id));
  }

  private readSkill(root: string, folderName: string): SkillManifest {
    const candidate = join(root, folderName, SKILL_FILE_NAME);
    const resolved = realpathSync(candidate);
    if (!resolved.startsWith(root + sep)) {
      throw new Error(`Skill "${folderName}" resolves outside the skills directory`);
    }

    const { size } = statSync(resolved);
    if (size > MAX_SKILL_FILE_BYTES) throw new Error(`Skill "${folderName}" exceeds the size limit`);

    return parseSkillDocument(readFileSync(resolved, "utf8"), folderName);
  }
}
