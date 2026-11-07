import { describe, expect, it } from "vitest";
import { designWorkspaceReducer, setComponentError, setComponentKind, setComponentSelection, setDesignMode } from "./workspaceSlice";

const initial = designWorkspaceReducer(undefined, { type: "init" });
const failed = designWorkspaceReducer(initial, setComponentError("The backend request failed."));

describe("component error", () => {
  it("is kept while nothing else changes", () => {
    expect(failed.componentError).toBe("The backend request failed.");
    expect(designWorkspaceReducer(failed, setComponentSelection(null)).componentError).toBe("The backend request failed.");
  });

  it("goes away when the mode or the kind of component changes", () => {
    expect(designWorkspaceReducer(failed, setDesignMode("object")).componentError).toBe("");
    expect(designWorkspaceReducer(failed, setComponentKind("edge")).componentError).toBe("");
  });

  it("goes away when new components are picked", () => {
    const picked = designWorkspaceReducer(failed, setComponentSelection({ objectId: "box", meshPath: [], ids: ["1"] }));
    expect(picked.componentError).toBe("");
    expect(picked.componentSelection?.ids).toEqual(["1"]);
  });
});
