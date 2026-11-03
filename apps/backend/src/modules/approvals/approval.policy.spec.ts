import type { EditorCommand } from "../../shared/types/editor-command.types.js";
import { ApprovalPolicy, LARGE_BATCH_THRESHOLD } from "./approval.policy.js";

const policy = new ApprovalPolicy();

const create = (id: string): EditorCommand => ({ commandId: `c-${id}`, type: "scene.create_object", objectId: id, name: id });

describe("ApprovalPolicy", () => {
  it("requires approval to change or clear a modifier stack", () => {
    expect(policy.requiresApproval([{ commandId: "clear", type: "geometry.set_modifiers", objectId: "mesh", meshPath: [], modifiers: [] }])).toBe(true);
  });
  it("requires approval for mesh bevel and subdivision", () => {
    expect(policy.requiresApproval([{ commandId: "b", type: "geometry.bevel", objectId: "a", meshPath: [], width: .1 }])).toBe(true);
    expect(policy.requiresApproval([{ commandId: "s", type: "geometry.subdivide", objectId: "a", meshPath: [], levels: 1 }])).toBe(true);
  });
  it("does not ask for approval for read-only creation and transforms", () => {
    expect(policy.requiresApproval([create("a"), { commandId: "t", type: "scene.transform_object", objectId: "a", transform: { position: [1, 0, 0] } }])).toBe(false);
  });

  it("asks for approval when objects are deleted", () => {
    expect(policy.requiresApproval([{ commandId: "d", type: "scene.delete_object", objectId: "a" }])).toBe(true);
  });

  it("asks for approval when geometry replaces existing content", () => {
    expect(
      policy.requiresApproval([{ commandId: "r", type: "geometry.create_primitive", objectId: "a", primitive: "box", size: 1, replaceExisting: true }]),
    ).toBe(true);
  });

  it("does not ask when geometry is only added", () => {
    expect(
      policy.requiresApproval([{ commandId: "n", type: "geometry.create_primitive", objectId: "a", primitive: "box", size: 1, replaceExisting: false }]),
    ).toBe(false);
  });

  it("asks for approval for large batches", () => {
    const batch = Array.from({ length: LARGE_BATCH_THRESHOLD + 1 }, (_, index) => create(`o${index}`));
    expect(policy.requiresApproval(batch)).toBe(true);
  });
});
