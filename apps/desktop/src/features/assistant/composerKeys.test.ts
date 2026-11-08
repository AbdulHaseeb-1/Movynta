import { describe, expect, it } from "vitest";
import { composerKeyAction } from "./composerKeys";

const press = (key: string, extra: { shiftKey?: boolean; isComposing?: boolean } = {}) => ({ key, shiftKey: false, isComposing: false, ...extra });

describe("composerKeyAction", () => {
  it("sends on Enter and leaves Shift+Enter to add a line", () => {
    expect(composerKeyAction(press("Enter"), false)).toBe("send");
    expect(composerKeyAction(press("Enter", { shiftKey: true }), false)).toBe("none");
  });

  it("stops a running reply on Esc, and does nothing when nothing is running", () => {
    expect(composerKeyAction(press("Escape"), true)).toBe("stop");
    expect(composerKeyAction(press("Escape"), false)).toBe("none");
  });

  it("leaves both keys to an input method that is composing", () => {
    expect(composerKeyAction(press("Enter", { isComposing: true }), false)).toBe("none");
    expect(composerKeyAction(press("Escape", { isComposing: true }), true)).toBe("none");
  });

  it("ignores every other key", () => {
    expect(composerKeyAction(press("a"), true)).toBe("none");
  });
});
