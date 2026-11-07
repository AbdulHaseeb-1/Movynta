import { describe, expect, it } from "vitest";
import { viewportShortcut, type ShortcutKey } from "@/features/viewport3d/viewportShortcuts";
import { EXAMPLE_IDS } from "../examples/exampleIds";
import { toolGuide } from "../toolGuide";
import { isHelpShortcut, isSearchShortcut, type HelpKey } from "./helpShortcut";
import { chordFromEvent, chordsOf, parseKeys } from "./keys";
import { filterShortcutGroups, findShortcuts, shortcutGroups } from "./shortcutReference";

const guideIds = new Set(toolGuide.flatMap((section) => section.tools.map((tool) => tool.id)));

function key(overrides: Partial<ShortcutKey> & Pick<ShortcutKey, "key" | "code">): ShortcutKey {
  return { ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, repeat: false, ...overrides };
}

describe("shortcut reference", () => {
  it("names each group and each control in a group once", () => {
    expect(new Set(shortcutGroups.map((group) => group.id)).size).toBe(shortcutGroups.length);
    for (const group of shortcutGroups) {
      const actions = group.controls.map((control) => control.action);
      expect(new Set(actions).size, group.name).toBe(actions.length);
    }
  });

  it("links only to guide entries that exist", () => {
    for (const control of shortcutGroups.flatMap((group) => group.controls)) {
      if (control.guide) expect(guideIds, control.action).toContain(control.guide);
    }
  });

  it("writes keys in the key grammar", () => {
    const texts = [
      ...shortcutGroups.flatMap((group) => group.controls.map((control) => control.keys)),
      ...toolGuide.flatMap((section) => section.tools.flatMap((tool) => (tool.shortcut ? [tool.shortcut] : []))),
    ];
    for (const text of texts) {
      for (const alternative of parseKeys(text)) {
        // A "+" or "then" left in a label means a key name was misspelled, so it would not be drawn or found.
        if (alternative.kind === "label") expect(alternative.text, text).not.toMatch(/\+| then /);
      }
    }
  });

  it("gives every guide shortcut at least one key or pointer action", () => {
    for (const tool of toolGuide.flatMap((section) => section.tools)) {
      if (tool.shortcut) expect(parseKeys(tool.shortcut).some((alternative) => alternative.kind === "keys"), tool.id).toBe(true);
    }
  });

  it("documents every key the viewport understands", () => {
    const presses = [
      key({ key: "1", code: "Numpad1" }),
      key({ key: "3", code: "Numpad3", ctrlKey: true }),
      key({ key: "7", code: "Numpad7" }),
      key({ key: "=", code: "Equal" }),
      key({ key: "+", code: "Equal", shiftKey: true }),
      key({ key: "-", code: "Minus" }),
      key({ key: "0", code: "Digit0" }),
      key({ key: ".", code: "Period" }),
      key({ key: "Home", code: "Home" }),
      key({ key: "Z", code: "KeyZ", shiftKey: true }),
      key({ key: "z", code: "KeyZ", altKey: true }),
    ];
    for (const event of presses) {
      expect(viewportShortcut(event), event.code).toBeDefined();
      const chord = chordFromEvent(event);
      expect(chord, event.code).toBeDefined();
      const groups = findShortcuts(shortcutGroups, chord ?? "").map((match) => match.group.id);
      expect(groups, chord).toContain("navigation");
    }
  });

  it("finds every mode a key works in", () => {
    const contexts = (chord: string) => findShortcuts(shortcutGroups, chord).map((match) => match.group.id);
    expect(contexts("G")).toEqual(expect.arrayContaining(["object", "edit", "extrusion"]));
    expect(contexts("Ctrl+Z")).toEqual(expect.arrayContaining(["knife", "history"]));
    expect(contexts("?")).toEqual(["help"]);
    expect(contexts("Ctrl+Q")).toEqual([]);
  });

  it("searches actions, keys and groups", () => {
    const actions = (query: string, group?: string) =>
      filterShortcutGroups(shortcutGroups, query, group).flatMap((match) => match.controls.map((control) => control.action));
    expect(actions("bevel width")).toContain("Bevel width");
    expect(actions("ctrl+b")).toContain("Bevel edges");
    expect(actions("", "knife")).toHaveLength(shortcutGroups.find((group) => group.id === "knife")?.controls.length ?? -1);
    expect(actions("no such control")).toEqual([]);
  });

  it("only points guide entries at examples that exist, and uses each example", () => {
    const used = new Set(toolGuide.flatMap((section) => section.tools.flatMap((tool) => (tool.example ? [tool.example] : []))));
    expect([...used].sort()).toEqual([...EXAMPLE_IDS].sort());
  });

  it("documents the keys that open help", () => {
    expect(chordsOf(shortcutGroups.find((group) => group.id === "help")?.controls[0]?.keys ?? "")).toEqual(["?", "F1"]);
  });
});

describe("help shortcuts", () => {
  const help = (overrides: Partial<HelpKey> & Pick<HelpKey, "key">): HelpKey =>
    ({ code: "", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, repeat: false, ...overrides });

  it("opens on ? outside text fields, and on F1 anywhere", () => {
    expect(isHelpShortcut(help({ key: "?", shiftKey: true }), false)).toBe(true);
    expect(isHelpShortcut(help({ key: "?", shiftKey: true }), true)).toBe(false);
    expect(isHelpShortcut(help({ key: "F1" }), true)).toBe(true);
  });

  it("ignores repeats and modified presses", () => {
    expect(isHelpShortcut(help({ key: "?", repeat: true }), false)).toBe(false);
    expect(isHelpShortcut(help({ key: "F1", ctrlKey: true }), false)).toBe(false);
  });

  it("moves to search on / outside text fields", () => {
    expect(isSearchShortcut(help({ key: "/" }), false)).toBe(true);
    expect(isSearchShortcut(help({ key: "/" }), true)).toBe(false);
    expect(isSearchShortcut(help({ key: "/", ctrlKey: true }), false)).toBe(false);
  });
});
