import { afterEach, describe, expect, it, vi } from "vitest";
import { isOverlayTarget, isShortcutBlocked, returnFocus } from "./dom";

afterEach(() => vi.unstubAllGlobals());

/**
 * A stand-in for an element: its tag, whether it is editable, and the role of the surface it sits in. The tests run
 * without a DOM, so the element classes are stubbed in for `instanceof`.
 */
function fakeElement(tagName: string, surface: string | null, editable = false): EventTarget {
  class FakeElement extends EventTarget {
    readonly tagName = tagName;
    readonly isContentEditable = editable;
    closest(selector: string) {
      return surface !== null && selector.includes(`[role="${surface}"]`) ? this : null;
    }
  }
  vi.stubGlobal("Element", FakeElement);
  vi.stubGlobal("HTMLElement", FakeElement);
  return new FakeElement();
}

describe("returning focus", () => {
  it("focuses the control that opened the dialog and takes over from the default", () => {
    const focus = vi.fn();
    const preventDefault = vi.fn();
    expect(returnFocus({ isConnected: true, focus }, { preventDefault })).toBe(true);
    expect(focus).toHaveBeenCalledOnce();
    expect(preventDefault).toHaveBeenCalledOnce();
  });

  it("leaves focus alone when the control is gone, for example after its project was deleted", () => {
    const focus = vi.fn();
    const preventDefault = vi.fn();
    expect(returnFocus({ isConnected: false, focus }, { preventDefault })).toBe(false);
    expect(returnFocus(null, { preventDefault })).toBe(false);
    expect(focus).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
  });
});

describe("isOverlayTarget", () => {
  it.each(["menu", "menubar", "listbox", "dialog", "alertdialog"])("recognises a key aimed at a %s", (role) => {
    expect(isOverlayTarget(fakeElement("DIV", role))).toBe(true);
  });

  it("leaves keys aimed at the scene alone, and is safe without a DOM", () => {
    expect(isOverlayTarget(fakeElement("DIV", null))).toBe(false);
    expect(isOverlayTarget(null)).toBe(false);
    vi.unstubAllGlobals();
    expect(isOverlayTarget(new EventTarget())).toBe(false);
  });
});

describe("isShortcutBlocked", () => {
  it("lets a key through when nothing in particular has the focus", () => {
    expect(isShortcutBlocked(null)).toBe(false);
    expect(isShortcutBlocked(fakeElement("DIV", null))).toBe(false);
  });

  it("lets a key through when a button has the focus, which keeps it after a click", () => {
    expect(isShortcutBlocked(fakeElement("BUTTON", null))).toBe(false);
  });

  it("blocks text fields, including editable regions", () => {
    expect(isShortcutBlocked(fakeElement("INPUT", null))).toBe(true);
    expect(isShortcutBlocked(fakeElement("TEXTAREA", null))).toBe(true);
    expect(isShortcutBlocked(fakeElement("DIV", null, true))).toBe(true);
  });

  it.each(["dialog", "alertdialog", "menu", "listbox"])("blocks a key aimed at a %s, even on a button inside it", (role) => {
    expect(isShortcutBlocked(fakeElement("BUTTON", role))).toBe(true);
  });
});
