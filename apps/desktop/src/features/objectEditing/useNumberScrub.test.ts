import { expect, it } from "vitest";
import { scrubValue } from "./useNumberScrub";

it("adjusts left and right relative to the start and supports fine dragging", () => {
  expect(scrubValue(1, 50, 0.1, false)).toBe(2);
  expect(scrubValue(1, -50, 0.1, false)).toBe(0);
  expect(scrubValue(1, 50, 0.1, true)).toBe(1.1);
});
it("clamps numeric bounds and rounds integer controls", () => {
  expect(scrubValue(1, -100, 0.1, false, 0.001)).toBe(0.001);
  expect(scrubValue(4, 100, 1, false, 1, 8)).toBe(8);
  expect(scrubValue(4, 3, 1, false, 1, 8)).toBe(5);
  expect(scrubValue(2, -100, 1, false, 1, 3)).toBe(1);
});
