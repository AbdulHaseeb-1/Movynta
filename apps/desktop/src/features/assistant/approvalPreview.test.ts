import { expect, it } from "vitest";
import { describeApproval } from "./approvalPreview";

it("shows component counts and actual transform values in the approval summary", () => {
  const view = describeApproval({ commands: [
    { commandId: "e", type: "geometry.extrude", objectId: "box", kind: "face", ids: ["2"], offset: [0, 1, 0] },
    { commandId: "m", type: "geometry.transform_faces", objectId: "box", ids: ["2"], space: "world", transform: { position: [1, 0, 0], rotation: [0, 1, 0] } },
  ] });
  expect(view.commands[0]?.text).toContain("local offset [0, 1, 0]");
  expect(view.commands[1]?.text).toContain("world");
  expect(view.commands[1]?.text).toContain("move [1, 0, 0]");
  expect(view.commands[1]?.text).toContain("rotate [0, 1, 0] radians");
});

it("says which name and parent a new shape gets, and keeps the old wording without them", () => {
  const view = describeApproval({ commands: [
    { commandId: "a", type: "geometry.create_primitive", objectId: "torso", primitive: "box", size: 2, name: "Torso", parentId: "figure" },
    { commandId: "b", type: "geometry.create_primitive", objectId: "plain", primitive: "sphere", size: 1 },
  ] });
  expect(view.commands[0]?.text).toBe("Add a box “Torso” to torso under figure (size 2)");
  expect(view.commands[1]?.text).toBe("Add a sphere to plain (size 1)");
});
