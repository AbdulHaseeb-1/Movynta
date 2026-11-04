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

it("says how far a relative move goes, and along which axes", () => {
  const view = describeApproval({ commands: [{ commandId: "m", type: "scene.move_object", objectId: "figure", delta: [0, 2, -1] }] });
  expect(view.commands[0]?.text).toBe("Move figure by [0, 2, -1] along its parent's axes");
});

it("describes collection changes in words, and says an object goes with what hangs below it", () => {
  const text = describeApproval({ commands: [
    { commandId: "a", type: "scene.create_collection", collectionId: "set", name: "Set" },
    { commandId: "b", type: "scene.create_collection", collectionId: "props", name: "Props", parentCollectionId: "set" },
    { commandId: "c", type: "scene.move_to_collection", objectId: "fig", collectionId: "set", includeChildren: true },
    { commandId: "d", type: "scene.move_to_collection", objectId: "fig", collectionId: null, includeChildren: false },
    { commandId: "e", type: "scene.set_collection_visibility", collectionId: "set", visible: false },
    { commandId: "f", type: "scene.delete_collection", collectionId: "props" },
  ] }).commands.map((command) => command.text);
  expect(text).toEqual([
    "Create collection “Set”",
    "Create collection “Props” in set",
    "Put fig and what hangs below it in collection set",
    "Put fig in the scene itself",
    "Hide collection set",
    "Delete the empty collection props",
  ]);
});
