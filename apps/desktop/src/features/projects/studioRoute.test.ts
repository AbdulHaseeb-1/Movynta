import { describe, expect, it } from "vitest";
import { createdAfterNavigation, projectToOpen } from "./studioRoute";

describe("opening a project from the studio address", () => {
  it("opens a saved project and nothing for a blank workspace", () => {
    expect(projectToOpen("p1", undefined)).toBe("p1");
    expect(projectToOpen(undefined, undefined)).toBeUndefined();
  });

  it("does not reload the project this workspace has just created", () => {
    expect(projectToOpen(undefined, "p1")).toBeUndefined();
    expect(projectToOpen("p1", "p1")).toBeUndefined();
  });

  it("loads the created project again when the user comes back to it from another project", () => {
    // blank workspace creates p1, the user duplicates it into p2, then presses Back
    let created: string | undefined = "p1";
    created = createdAfterNavigation("p2", created);
    expect(projectToOpen("p2", created)).toBe("p2");
    expect(projectToOpen("p1", created)).toBe("p1");
  });

  it("keeps the created project while the address follows it", () => {
    expect(createdAfterNavigation(undefined, "p1")).toBe("p1");
    expect(createdAfterNavigation("p1", "p1")).toBe("p1");
  });
});
