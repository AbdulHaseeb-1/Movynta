import { describe, expect, it } from "vitest";
import { parseSnapAngle } from "./knifeSettings";

describe("parseSnapAngle", () => {
  it("accepts an angle above 0 up to 180 degrees", () => {
    expect(parseSnapAngle("45")).toBe(45);
    expect(parseSnapAngle("0.5")).toBe(0.5);
    expect(parseSnapAngle("180")).toBe(180);
  });

  it.each(["", "  ", "0", "-5", "181", "abc", "Infinity", "NaN"])("rejects %j", (text) => {
    expect(parseSnapAngle(text)).toBeNull();
  });
});
