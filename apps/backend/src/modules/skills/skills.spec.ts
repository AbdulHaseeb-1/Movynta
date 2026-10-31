import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
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
  it("loads the four repository skills, including the dotted 2.5d id", () => {
    const ids = new SkillsLoader()
      .load(repositorySkills)
      .map((skill) => skill.id);
    expect(ids).toEqual(["2.5d-character-design", "character-modeling", "character-rigging", "mesh-editing"]);
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

  it("selects rigging when the request is about a skeleton", () => {
    const ids = registry.selectRelevant({ message: "Add a skeleton so I can rig the character", dimension: "3d" }).map((s) => s.id);
    expect(ids).toContain("character-rigging");
  });

  it("selects the 2.5D skill for layered sprite requests", () => {
    const ids = registry.selectRelevant({ message: "Make a layered sprite with parallax", dimension: "2.5d" }).map((s) => s.id);
    expect(ids[0]).toBe("2.5d-character-design");
  });

  it("never returns more than two skills", () => {
    const ids = registry.selectRelevant({ message: "character humanoid mesh skeleton rig layer sprite", dimension: "3d" });
    expect(ids.length).toBeLessThanOrEqual(2);
  });

  it("selects nothing for an unrelated request", () => {
    expect(registry.selectRelevant({ message: "What is the weather today?" })).toEqual([]);
  });
});
