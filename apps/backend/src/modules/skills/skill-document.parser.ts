import { z } from "zod";
import { isOneOf } from "../../shared/guards/enum.guard.js";
import { MODELING_DIMENSIONS } from "../../shared/schemas/modeling-plan.schema.js";
import type { SkillManifest } from "./skills.types.js";

const SCALAR_KEYS = ["name", "version", "description"] as const;
const LIST_KEYS = [
  "dimensions",
  "tags",
  "when_to_use",
  "required_inputs",
  "tools",
  "validation",
  "error_handling",
] as const;

const frontmatterSchema = z
  .object({
    name: z.string().regex(/^[a-z0-9][a-z0-9.-]{1,63}$/).refine((value) => !value.includes(".."), "Skill names cannot contain '..'"),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    description: z.string().min(10).max(300),
    dimensions: z.array(z.enum(MODELING_DIMENSIONS)).min(1),
    tags: z.array(z.string().min(1).max(40)).min(1),
    when_to_use: z.array(z.string().min(3).max(200)).min(1),
    required_inputs: z.array(z.string().min(1).max(200)).min(1),
    tools: z.array(z.string().regex(/^[a-z_]+\.[a-z_]+$/)).min(1),
    validation: z.array(z.string().min(1).max(300)).min(1),
    error_handling: z.array(z.string().min(1).max(300)).min(1),
  })
  .strict();

const FENCE = "---";
const KEY_LINE = /^([a-z_]+):\s*(.*)$/;
const LIST_ITEM = /^\s+-\s+(.+)$/;

type RawFrontmatter = Record<string, string | string[]>;

/**
 * Reads the restricted frontmatter subset used by SKILL.md:
 * `key: value` for scalars and `key:` followed by `  - item` lines for lists.
 * Anything else is rejected, so skill files cannot smuggle structure or code.
 */
function parseFrontmatter(block: string): RawFrontmatter {
  const result: RawFrontmatter = {};
  let listKey: string | undefined;

  for (const line of block.split(/\r?\n/)) {
    if (line.trim().length === 0) continue;

    const item = LIST_ITEM.exec(line);
    if (item) {
      if (!listKey) throw new Error("List item without a list key in SKILL.md frontmatter");
      const current = result[listKey];
      if (!Array.isArray(current)) throw new Error(`Key "${listKey}" is not a list`);
      current.push(item[1]?.trim() ?? "");
      continue;
    }

    const key = KEY_LINE.exec(line);
    if (!key) throw new Error(`Unsupported frontmatter line: "${line.trim()}"`);
    const name = key[1] ?? "";
    const value = (key[2] ?? "").trim();
    if (name in result) throw new Error(`Duplicate frontmatter key "${name}"`);

    if (value.length > 0) {
      if (!isOneOf(SCALAR_KEYS, name)) throw new Error(`Key "${name}" must be a list`);
      result[name] = value;
      listKey = undefined;
    } else {
      if (!isOneOf(LIST_KEYS, name)) throw new Error(`Key "${name}" must have a value`);
      result[name] = [];
      listKey = name;
    }
  }
  return result;
}

/** Splits a SKILL.md file into validated metadata and the markdown workflow body. */
export function parseSkillDocument(source: string, folderName: string): SkillManifest {
  const lines = source.split(/\r?\n/);
  if (lines[0] !== FENCE) throw new Error("SKILL.md must start with a frontmatter block");
  const closing = lines.indexOf(FENCE, 1);
  if (closing === -1) throw new Error("SKILL.md frontmatter is not closed");

  const meta = frontmatterSchema.parse(parseFrontmatter(lines.slice(1, closing).join("\n")));
  if (meta.name !== folderName) throw new Error(`Skill name "${meta.name}" must match its folder "${folderName}"`);

  const instructions = lines.slice(closing + 1).join("\n").trim();
  if (instructions.length === 0) throw new Error(`Skill "${meta.name}" has no workflow instructions`);

  return {
    id: meta.name,
    name: meta.name,
    version: meta.version,
    description: meta.description,
    dimensions: meta.dimensions,
    tags: meta.tags,
    whenToUse: meta.when_to_use,
    requiredInputs: meta.required_inputs,
    toolNames: meta.tools,
    validation: meta.validation,
    errorHandling: meta.error_handling,
    instructions,
  };
}
