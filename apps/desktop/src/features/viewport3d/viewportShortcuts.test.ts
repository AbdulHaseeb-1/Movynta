import { describe, expect, it } from "vitest";
import { viewportShortcut, type ShortcutKey } from "./viewportShortcuts";

const press = (key: string, code: string, modifiers: Partial<ShortcutKey> = {}): ShortcutKey => ({
  key, code, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, repeat: false, ...modifiers,
});

describe("viewport shortcuts", () => {
  it("maps the numpad to views, with Ctrl for the other side", () => {
    expect(viewportShortcut(press("1", "Numpad1"))).toMatchObject({ kind: "view", preset: { id: "front" } });
    expect(viewportShortcut(press("1", "Numpad1", { ctrlKey: true }))).toMatchObject({ kind: "view", preset: { id: "back" } });
    expect(viewportShortcut(press("7", "Numpad7"))).toMatchObject({ kind: "view", preset: { id: "top" } });
  });

  it("toggles wireframe with Shift+Z and X-ray with Alt+Z, whatever the keyboard layout prints", () => {
    expect(viewportShortcut(press("Z", "KeyZ", { shiftKey: true }))).toEqual({ kind: "toggle-wireframe" });
    expect(viewportShortcut(press("Ω", "KeyZ", { altKey: true }))).toEqual({ kind: "toggle-xray" });
  });

  it("leaves Ctrl+Z, Ctrl+Shift+Z and a plain Z to undo, redo and the axis locks", () => {
    expect(viewportShortcut(press("z", "KeyZ", { ctrlKey: true }))).toBeUndefined();
    expect(viewportShortcut(press("Z", "KeyZ", { ctrlKey: true, shiftKey: true }))).toBeUndefined();
    expect(viewportShortcut(press("z", "KeyZ"))).toBeUndefined();
  });

  it("zooms, resets and frames with the same keys as the toolbar", () => {
    expect(viewportShortcut(press("+", "Equal", { shiftKey: true }))).toEqual({ kind: "zoom", direction: "in" });
    expect(viewportShortcut(press("-", "Minus"))).toEqual({ kind: "zoom", direction: "out" });
    expect(viewportShortcut(press("0", "Digit0"))).toEqual({ kind: "reset" });
    expect(viewportShortcut(press(".", "Period"))).toEqual({ kind: "frame", scope: "selection" });
    expect(viewportShortcut(press("Home", "Home"))).toEqual({ kind: "frame", scope: "all" });
  });

  it("ignores held keys and other modifiers", () => {
    expect(viewportShortcut(press("1", "Numpad1", { repeat: true }))).toBeUndefined();
    expect(viewportShortcut(press("0", "Digit0", { ctrlKey: true }))).toBeUndefined();
    expect(viewportShortcut(press("1", "Numpad1", { metaKey: true }))).toBeUndefined();
  });
});
