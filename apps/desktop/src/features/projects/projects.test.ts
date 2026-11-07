import { describe, expect, it } from "vitest";
import { Scene } from "three";
import { EditorScene } from "../assistant/EditorScene";
import { formatRelativeTime } from "./formatRelativeTime";
import { libraryToggleVisible } from "./libraryToggle";
import { projectPath, PROJECT_CATEGORY_CATALOG } from "./projectCategories";
import { displayName, isUntitled } from "./projectName";
import { listQuery } from "./projectsApi";
import { projectChanged, projectRemoved, projectsLoaded, projectsReducer } from "./projectsSlice";
import { defaultProjectFilters, type Project } from "./projectTypes";

const now = Date.parse("2026-11-02T12:00:00.000Z");
const ago = (milliseconds: number) => new Date(now - milliseconds).toISOString();
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: "prj_1",
    name: "",
    category: "design",
    starred: false,
    archived: false,
    createdAt: ago(DAY),
    updatedAt: ago(HOUR),
    runCount: 0,
    firstPrompt: "",
    ...overrides,
  };
}

describe("listQuery", () => {
  it("lists the working set by last update when nothing is filtered", () => {
    expect(listQuery(defaultProjectFilters)).toBe("scope=active&sort=updated");
  });

  it("maps each view and filter to the backend's parameters", () => {
    expect(listQuery({ ...defaultProjectFilters, view: "archived" })).toContain("scope=archived");
    expect(listQuery({ ...defaultProjectFilters, view: "starred" })).toContain("starred=true");
    expect(listQuery({ ...defaultProjectFilters, category: "design", sort: "name" })).toBe(
      "category=design&scope=active&sort=name",
    );
  });

  it("trims and encodes the search text", () => {
    const query = listQuery({ ...defaultProjectFilters, search: "  50% crate & lid " });
    expect(new URLSearchParams(query).get("search")).toBe("50% crate & lid");
    expect(listQuery({ ...defaultProjectFilters, search: "   " })).not.toContain("search");
  });
});

describe("formatRelativeTime", () => {
  it("reads naturally from seconds to weeks", () => {
    expect(formatRelativeTime(ago(10_000), now)).toBe("Just now");
    expect(formatRelativeTime(ago(5 * MINUTE), now)).toBe("5 min. ago");
    expect(formatRelativeTime(ago(3 * HOUR), now)).toBe("3 hr. ago");
    expect(formatRelativeTime(ago(DAY), now)).toBe("yesterday");
    expect(formatRelativeTime(ago(3 * DAY), now)).toBe("3 days ago");
  });

  it("switches to a calendar date after a week, with the year only when it differs", () => {
    expect(formatRelativeTime(ago(20 * DAY), now)).toBe("Oct 13");
    expect(formatRelativeTime("2025-03-04T10:00:00.000Z", now)).toBe("Mar 4, 2025");
  });

  it("copes with the future and with garbage", () => {
    expect(formatRelativeTime(new Date(now + HOUR).toISOString(), now)).toBe("Just now");
    expect(formatRelativeTime("not a date", now)).toBe("");
  });
});

describe("project names and paths", () => {
  it("shows untitled projects as such until they are named", () => {
    expect(isUntitled(project())).toBe(true);
    expect(isUntitled(project({ name: "   " }))).toBe(true);
    expect(displayName(project())).toBe("Untitled project");
    expect(displayName(project({ name: "Pine tree" }))).toBe("Pine tree");
  });

  it("opens each category in its own workspace", () => {
    expect(projectPath(project({ id: "prj_abc" }))).toBe("/studio/prj_abc");
    expect(PROJECT_CATEGORY_CATALOG.design.workspacePath()).toBe("/studio");
  });
});

describe("projects store", () => {
  it("replaces a changed project in place and drops a removed one", () => {
    const first = project({ id: "a" });
    const second = project({ id: "b" });
    let state = projectsReducer(undefined, projectsLoaded([first, second]));
    state = projectsReducer(state, projectChanged({ ...first, name: "Renamed" }));
    expect(state.items.map((item) => item.name)).toEqual(["Renamed", ""]);
    state = projectsReducer(state, projectRemoved("a"));
    expect(state.items.map((item) => item.id)).toEqual(["b"]);
    expect(state.status).toBe("ready");
  });
});

const box = (commandId: string, objectId: string) => ({
  commandId,
  type: "geometry.create_primitive",
  objectId,
  primitive: "box",
  size: 1,
  replaceExisting: false,
});

const noImports = () => Promise.reject(new Error("This test has no imported models"));
const commands = (proposalId: string, ...list: unknown[]) => ({
  kind: "commands" as const,
  proposalId,
  commands: list,
});

describe("restoring a saved scene", () => {
  it("replays the saved batches in order and lands on the same revision", async () => {
    const editor = new EditorScene(new Scene(), "prj_1");
    await editor.restore(
      [commands("p1", box("a", "one")), commands("p2", box("b", "two"))],
      noImports,
    );
    expect(editor.context().objects.map((object) => object.id)).toEqual(["one", "two"]);
    expect(editor.context().revision).toBe(2);
  });

  it("refuses a damaged scene instead of showing part of it", async () => {
    const editor = new EditorScene(new Scene(), "prj_1");
    await expect(
      editor.restore([commands("p1", box("a", "one"), box("b", "one"))], noImports),
    ).rejects.toThrow("could not be restored");
  });

  it("takes the id of a project created after the editor opened", () => {
    const editor = new EditorScene(new Scene(), "unsaved-project");
    editor.bindProject("prj_9");
    expect(editor.projectId).toBe("prj_9");
    expect(editor.context().projectId).toBe("prj_9");
  });
});

describe("the View all button", () => {
  it("stays while a list is loading, so a filter change does not take keyboard focus away", () => {
    expect(libraryToggleVisible(true, "ready")).toBe(true);
    expect(libraryToggleVisible(true, "loading")).toBe(true);
  });

  it("is hidden until there is a list to show", () => {
    expect(libraryToggleVisible(true, "idle")).toBe(false);
    expect(libraryToggleVisible(true, "error")).toBe(false);
    expect(libraryToggleVisible(false, "ready")).toBe(false);
  });
});
