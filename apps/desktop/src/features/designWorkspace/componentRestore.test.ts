import { describe, expect, it } from "vitest";
import { Scene } from "three";
import { EditorScene } from "@/features/assistant/EditorScene";
import { queueComponentSelection, takeComponentSelection } from "./componentRestore";

describe("queued component selection", () => {
  it("is taken only by the scene and object it was queued for, and only once", () => {
    const project = new EditorScene(new Scene(), "project");
    const other = new EditorScene(new Scene(), "project");
    queueComponentSelection({ scene: project, objectId: "box", meshPath: [], ids: ["1"] });
    expect(takeComponentSelection(other, "box")).toBeNull();
    expect(takeComponentSelection(project, "sphere")).toBeNull();
    expect(takeComponentSelection(project, "box")?.ids).toEqual(["1"]);
    expect(takeComponentSelection(project, "box")).toBeNull();
  });
});
