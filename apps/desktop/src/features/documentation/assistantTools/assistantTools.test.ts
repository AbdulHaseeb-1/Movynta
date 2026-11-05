import { describe, expect, it } from "vitest";
import { assistantToolDocument, matchesTool, toolAnchor, toolsOfType } from "./assistantTools";

const { tools, types } = assistantToolDocument;

describe("assistant tool reference", () => {
  it("names every tool once", () => {
    const names = tools.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("gives every tool type at least one tool", () => {
    for (const type of types) {
      expect(toolsOfType(assistantToolDocument, type.id).length).toBeGreaterThan(0);
    }
  });

  it("links only to tools that exist", () => {
    const names = new Set(tools.map((tool) => tool.name));
    for (const tool of tools) {
      for (const related of tool.related) {
        expect(names.has(related), `${tool.name} links to ${related}`).toBe(true);
      }
    }
  });

  it("gives each card an anchor that no other card shares", () => {
    const anchors = tools.map((tool) => toolAnchor(tool.name));
    expect(new Set(anchors).size).toBe(anchors.length);
  });

  it("finds a tool by a word in its input or its result", () => {
    const inspect = tools.find((tool) => tool.name === "editor.inspect_mesh");
    expect(inspect && matchesTool(inspect, "faceq")).toBe(true);
    expect(inspect && matchesTool(inspect, "zzz-no-such-word")).toBe(false);
  });

  it("explains how each tool is checked", () => {
    for (const tool of tools) {
      expect(["code", "live"]).toContain(tool.verify);
      expect(tool.when.length).toBeGreaterThan(0);
    }
  });
});
