import { afterEach, describe, expect, it, vi } from "vitest";
import { shortcutsBlocked } from "./shortcutGuard";

afterEach(() => vi.unstubAllGlobals());

/** A stand-in for an element: its tag, whether it is editable, and the role of the surface it sits in. */
function fakeElement(tagName: string, surface: string | null, editable = false): EventTarget {
  class FakeElement extends EventTarget {
    readonly tagName = tagName;
    readonly isContentEditable = editable;
    closest(selector: string) {
      return surface !== null && selector.includes(`[role="${surface}"]`) ? this : null;
    }
  }
  vi.stubGlobal("HTMLElement", FakeElement);
  return new FakeElement();
}

describe("shortcutsBlocked", () => {
  it("lets a key through when nothing in particular has the focus", () => {
    expect(shortcutsBlocked({ target: null })).toBe(false);
    expect(shortcutsBlocked({ target: fakeElement("DIV", null) })).toBe(false);
  });

  it("leaves text fields alone", () => {
    expect(shortcutsBlocked({ target: fakeElement("INPUT", null) })).toBe(true);
    expect(shortcutsBlocked({ target: fakeElement("DIV", null, true) })).toBe(true);
  });

  it.each(["dialog", "alertdialog", "menu", "listbox"])("leaves a %s alone, so Escape and letters reach it", (role) => {
    expect(shortcutsBlocked({ target: fakeElement("BUTTON", role) })).toBe(true);
  });
});
