import type { EditorCommand } from "../../shared/types/editor-command.types.js";
import { MAX_COMMANDS_PER_PROPOSAL } from "@movynta/editor-protocol";
import { ApprovalPolicy } from "./approval.policy.js";

const policy = new ApprovalPolicy();

const create = (id: string): EditorCommand => ({ commandId: `c-${id}`, type: "scene.create_object", objectId: id, name: id });

describe("ApprovalPolicy", () => {
  it("automatically permits to change or clear a modifier stack", () => {
    expect(policy.requiresApproval([{ commandId: "clear", type: "geometry.set_modifiers", objectId: "mesh", meshPath: [], modifiers: [] }])).toBe(false);
  });
  it("automatically permits for mesh bevel and subdivision", () => {
    expect(policy.requiresApproval([{ commandId: "b", type: "geometry.bevel", objectId: "a", meshPath: [], width: .1 }])).toBe(false);
    expect(policy.requiresApproval([{ commandId: "s", type: "geometry.subdivide", objectId: "a", meshPath: [], levels: 1 }])).toBe(false);
    expect(policy.requiresApproval([{ commandId: "e", type: "geometry.extrude", objectId: "a", meshPath: [], kind: "face", ids: ["0"], offset: [0, 1, 0] }])).toBe(false);
    expect(policy.requiresApproval([{ commandId: "f", type: "geometry.subdivide_faces", objectId: "a", meshPath: [], ids: ["0"] }])).toBe(false);
    expect(policy.requiresApproval([{ commandId: "i", type: "geometry.inset_faces", objectId: "a", meshPath: [], ids: ["0"], thickness: 0.1 }])).toBe(false);
    expect(policy.requiresApproval([{ commandId: "m", type: "geometry.transform_faces", objectId: "a", meshPath: [], ids: ["0"], space: "local", transform: { scale: [2, 1, 1] } }])).toBe(false);
    expect(policy.requiresApproval([{ commandId: "b", type: "geometry.boolean", objectId: "a", meshPath: [], operandObjectId: "b", operandMeshPath: [], operation: "difference" }])).toBe(false);
  });
  it("does not ask for approval for read-only creation and transforms", () => {
    expect(policy.requiresApproval([create("a"), { commandId: "t", type: "scene.transform_object", objectId: "a", transform: { position: [1, 0, 0] } }])).toBe(false);
  });

  it("automatically permits when objects are deleted", () => {
    expect(policy.requiresApproval([{ commandId: "d", type: "scene.delete_object", objectId: "a" }])).toBe(false);
  });

  it("automatically permits when geometry replaces existing content", () => {
    expect(
      policy.requiresApproval([{ commandId: "r", type: "geometry.create_primitive", objectId: "a", primitive: "box", size: 1, replaceExisting: true }]),
    ).toBe(false);
  });

  it("does not ask when geometry is only added", () => {
    expect(
      policy.requiresApproval([{ commandId: "n", type: "geometry.create_primitive", objectId: "a", primitive: "box", size: 1, replaceExisting: false }]),
    ).toBe(false);
  });

  it("automatically permits large batches", () => {
    const batch = Array.from({ length: MAX_COMMANDS_PER_PROPOSAL }, (_, index) => create(`o${index}`));
    expect(policy.requiresApproval(batch)).toBe(false);
  });
});
