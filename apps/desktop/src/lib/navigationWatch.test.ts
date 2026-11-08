import { describe, expect, it } from "vitest";
import { createNavigationWatch } from "./navigationWatch";

describe("the navigation watch", () => {
  it("reports a change once, then stays quiet while the page stays the same", () => {
    const changed = createNavigationWatch("/");
    expect(changed("/")).toBe(false);
    expect(changed("/documentation?tool=pan")).toBe(true);
    expect(changed("/documentation?tool=pan")).toBe(false);
  });

  it("counts a different query on the same path as another page", () => {
    const changed = createNavigationWatch("/documentation");
    expect(changed("/documentation?area=shortcuts")).toBe(true);
  });
});
