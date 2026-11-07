import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseSkillDocument } from "./skill-document.parser.js";
import { SkillsLoader } from "./skills.loader.js";
import { SkillsRegistry } from "./skills.registry.js";

const repositorySkills = resolve(process.cwd(), "../../skills");

const validDocument = `---
name: sample-skill
version: 1.0.0
description: A sample skill used only by the unit tests.
dimensions:
  - 3d
tags:
  - sample
when_to_use:
  - The user asks for a sample.
required_inputs:
  - A sample name.
tools:
  - editor.get_context
validation:
  - The sample is checked.
error_handling:
  - Report the sample error.
---

# Workflow

1. Do the sample.
`;

function skillFolder(name: string, document: string): string {
  const root = mkdtempSync(join(tmpdir(), "movynta-skills-"));
  mkdirSync(join(root, name));
  writeFileSync(join(root, name, "SKILL.md"), document);
  return root;
}

describe("parseSkillDocument", () => {
  it("parses metadata and keeps the workflow body", () => {
    const skill = parseSkillDocument(validDocument, "sample-skill");
    expect(skill.id).toBe("sample-skill");
    expect(skill.version).toBe("1.0.0");
    expect(skill.dimensions).toEqual(["3d"]);
    expect(skill.toolNames).toEqual(["editor.get_context"]);
    expect(skill.instructions).toContain("1. Do the sample.");
  });

  it("rejects a document without frontmatter", () => {
    expect(() => parseSkillDocument("# Just markdown", "sample-skill")).toThrow(/frontmatter/);
  });

  it("rejects a name that does not match its folder", () => {
    expect(() => parseSkillDocument(validDocument, "other-folder")).toThrow(/must match its folder/);
  });

  it("rejects a list value given to a scalar key", () => {
    const broken = validDocument.replace("version: 1.0.0", "version:\n  - 1.0.0");
    expect(() => parseSkillDocument(broken, "sample-skill")).toThrow();
  });

  it("rejects unknown frontmatter keys", () => {
    const broken = validDocument.replace("name: sample-skill", "name: sample-skill\nexecute_script: rm");
    expect(() => parseSkillDocument(broken, "sample-skill")).toThrow();
  });

  it("rejects tool references that are not namespace.name", () => {
    const broken = validDocument.replace("editor.get_context", "rm -rf /");
    expect(() => parseSkillDocument(broken, "sample-skill")).toThrow();
  });
});

describe("SkillsLoader", () => {
  it("loads the repository skills", () => {
    const ids = new SkillsLoader()
      .load(repositorySkills)
      .map((skill) => skill.id);
    expect(ids).toEqual([
      "character-modeling",
      "mesh-editing",
      "model-design-principles",
      "pbr-materials-and-color",
      "props-hard-surface",
      "topology-and-subdivision",
    ]);
  });

  it("rejects folder names that could escape the skills root", () => {
    const root = skillFolder("ok-skill", validDocument.replace("sample-skill", "ok-skill"));
    mkdirSync(join(root, "Bad Name"));
    expect(() => new SkillsLoader().load(root)).toThrow(/Invalid skill folder name/);
  });

  it("rejects duplicate ids through the registry", () => {
    const skills = new SkillsLoader().load(repositorySkills);
    const registry = new SkillsRegistry({ skills: { directory: repositorySkills } } as never, new SkillsLoader());
    registry.registerAll(skills);
    expect(() => registry.registerAll([skills[0], skills[0]].filter((s): s is NonNullable<typeof s> => s !== undefined))).toThrow(
      /Duplicate skill id/,
    );
  });
});

describe("SkillsRegistry.selectRelevant", () => {
  const registry = new SkillsRegistry({ skills: { directory: repositorySkills } } as never, new SkillsLoader());
  registry.registerAll(new SkillsLoader().load(repositorySkills));

  it("selects character modeling for a 3D humanoid request", () => {
    const ids = registry.selectRelevant({ message: "Create a 3D humanoid character", dimension: "3d" }).map((s) => s.id);
    expect(ids).toContain("character-modeling");
  });

  it("never returns more than two skills", () => {
    const ids = registry.selectRelevant({ message: "character humanoid mesh layer sprite", dimension: "3d" });
    expect(ids.length).toBeLessThanOrEqual(2);
  });

  it("selects the hard-surface skill for a furniture prop", () => {
    const ids = registry.selectRelevant({ message: "Model a wooden chair prop", dimension: "3d" }).map((s) => s.id);
    expect(ids[0]).toBe("props-hard-surface");
  });

  it("selects the materials skill for a colour palette request", () => {
    const ids = registry.selectRelevant({ message: "Give it a metal material and a better color palette", dimension: "3d" }).map((s) => s.id);
    expect(ids[0]).toBe("pbr-materials-and-color");
  });

  it("selects the topology skill for subdivision pinching", () => {
    const ids = registry.selectRelevant({ message: "Fix the pinching poles after subdivision", dimension: "3d" }).map((s) => s.id);
    expect(ids[0]).toBe("topology-and-subdivision");
  });

  it("keeps the earlier defaults for a 3D request that names no tag", () => {
    const ids = registry.selectRelevant({ message: "Make it twice as tall", dimension: "3d" }).map((s) => s.id);
    expect(ids).toEqual(["character-modeling", "mesh-editing"]);
  });

  it("names only tools listed in the assistant tool inventory", () => {
    const inventory = readFileSync(resolve(repositorySkills, "../docs/assistant-tools.md"), "utf8");
    const documented = new Set(
      [...inventory.matchAll(/^\| `([a-z_]+\.[a-z_]+)` \| `[a-z_]+__[a-z_]+` \|/gm)].map((match) => match[1]),
    );
    expect(documented.size).toBeGreaterThan(10);
    for (const skill of registry.all()) {
      expect(skill.toolNames.filter((tool) => !documented.has(tool))).toEqual([]);
    }
  });

  it("holds every repository skill to working in chunks, each checked before the next", () => {
    const skills = registry.all();
    expect(skills.map((skill) => skill.id).sort()).toEqual([
      "character-modeling",
      "mesh-editing",
      "model-design-principles",
      "pbr-materials-and-color",
      "props-hard-surface",
      "topology-and-subdivision",
    ]);
    const missing: string[] = [];
    for (const skill of skills) {
      // A rule in the front matter, which the model reads in every list of skills, and a section with the steps.
      if (!skill.validation.some((rule) => /chunk|one slot at a time/i.test(rule))) missing.push(`${skill.id}: no chunk rule in validation`);
      if (!skill.errorHandling.some((rule) => /do not|never|stop/i.test(rule) && /fail|expected|refused|worse/i.test(rule))) missing.push(`${skill.id}: no stop rule in error handling`);
      if (!/^## (Chunks and gates|Working in chunks)$/m.test(skill.instructions)) missing.push(`${skill.id}: no chunks section`);
      if (!/gate|check/i.test(skill.instructions)) missing.push(`${skill.id}: no gate`);
      if (Buffer.byteLength(skill.instructions) >= 64 * 1024) missing.push(`${skill.id}: too large`);
    }
    expect(missing).toEqual([]);
  });

  it("selects nothing for an unrelated request", () => {
    expect(registry.selectRelevant({ message: "What is the weather today?" })).toEqual([]);
  });
});
