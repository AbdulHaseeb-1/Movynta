import { afterEach, expect, it, vi } from "vitest";
import { isOverlayTarget } from "./overlayTarget";

afterEach(() => vi.unstubAllGlobals());

/** An element that sits inside the given roles, nearest first, as far as `closest` can tell. */
function fakeElementIn(...roles: string[]) {
  class FakeElement extends EventTarget {
    closest(selector: string): FakeElement | null {
      return roles.some((role) => selector.includes(`[role="${role}"]`)) ? this : null;
    }
  }
  vi.stubGlobal("Element", FakeElement);
  return new FakeElement();
}

it("recognizes keys aimed at an open menu, list or dialog", () => {
  for (const role of ["menu", "listbox", "dialog", "alertdialog"]) expect(isOverlayTarget(fakeElementIn(role))).toBe(true);
});

it("leaves keys aimed at the scene alone", () => {
  expect(isOverlayTarget(fakeElementIn())).toBe(false);
  expect(isOverlayTarget(null)).toBe(false);
});

it("is safe where there is no DOM", () => {
  expect(isOverlayTarget(new EventTarget())).toBe(false);
});
