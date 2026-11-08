import { globMatches } from "./glob.js";

describe("globMatches", () => {
  it.each([
    ["window", "Window", true],
    ["win*", "Window.003", true],
    ["*.003", "Window.003", true],
    ["w*w*3", "Window.003", true],
    ["w?ndow", "window", true],
    ["w?ndow", "wndow", false],
    ["*", "", true],
    ["", "", true],
    ["", "a", false],
    ["win", "window", false],
    ["*dow", "window", true],
    ["*dow*", "window", true],
    ["a*b*c", "aXbYcZ", false],
    ["a*b*c", "aXbYc", true],
    ["**x", "yyx", true],
  ])("%s against %s is %s", (pattern, text, expected) => {
    expect(globMatches(pattern, text)).toBe(expected);
  });

  it("does not slow down with many stars on a text that almost matches", () => {
    const started = performance.now();
    expect(globMatches("*a*a*a*a*a*a*a*a*a*b", "a".repeat(120))).toBe(false);
    expect(performance.now() - started).toBeLessThan(50);
  });
});
