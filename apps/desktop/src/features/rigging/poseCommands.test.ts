import { describe, expect, it } from "vitest";
import {
  editorCommandListSchema,
  MAX_COMMANDS_PER_PROPOSAL,
  sceneCommandListSchema,
} from "@movynta/editor-protocol";
import type { ObjectTransform } from "@/features/assistant";
import { poseCommand, restoreBatches } from "./poseCommands";
import { boneAt, poseOf, rigOf, type Rig } from "./rig";
import { buildRiggedModel } from "./rigFixture";

function rigFor(boneCount: number): Rig {
  const rig = rigOf(buildRiggedModel(boneCount));
  if (!rig) throw new Error("expected a rig");
  return rig;
}

const TRANSFORM: ObjectTransform = { position: [0, 1, 0], rotation: [0, 0.5, 0], scale: [1, 1, 1] };

describe("pose commands", () => {
  it("are valid scene commands, and are not commands the assistant can propose", () => {
    const command = poseCommand("robot", 3, TRANSFORM);
    expect(sceneCommandListSchema.safeParse([command]).success).toBe(true);
    expect(editorCommandListSchema.safeParse([command]).success).toBe(false);
  });

  it("are refused for a bone that is not a whole non-negative number", () => {
    const accepted = (bone: number) =>
      sceneCommandListSchema.safeParse([{ ...poseCommand("a", 0, TRANSFORM), bone }]).success;
    expect(accepted(0)).toBe(true);
    expect(accepted(-1)).toBe(false);
    expect(accepted(1.5)).toBe(false);
  });
});

describe("putting a pose back", () => {
  it("needs nothing when no bone has moved", () => {
    expect(restoreBatches("robot", rigFor(5))).toEqual([]);
  });

  it("returns only the bones that moved, to where the file had them, and remembers how to undo it", () => {
    const rig = rigFor(5);
    const moved = boneAt(rig, 2);
    if (!moved) throw new Error("expected a bone");
    const rest = rig.rest[2];
    moved.rotation.x = 0.8;
    const posed = poseOf(moved);

    const batches = restoreBatches("robot", rig);
    expect(batches).toHaveLength(1);
    expect(batches[0]?.commands).toEqual([poseCommand("robot", 2, rest ?? posed)]);
    expect(batches[0]?.undo).toEqual([poseCommand("robot", 2, posed)]);
  });

  it("splits a large pose into batches the editor accepts", () => {
    const rig = rigFor(MAX_COMMANDS_PER_PROPOSAL * 2 + 10);
    for (const bone of rig.bones) bone.rotation.z = 0.3;
    const batches = restoreBatches("robot", rig);
    expect(batches.map((batch) => batch.commands.length)).toEqual([MAX_COMMANDS_PER_PROPOSAL, MAX_COMMANDS_PER_PROPOSAL, 10]);
    for (const batch of batches) {
      expect(sceneCommandListSchema.safeParse(batch.commands).success).toBe(true);
      expect(batch.undo).toHaveLength(batch.commands.length);
    }
    const ids = batches.flatMap((batch) => batch.commands.map((command) => command.bone));
    expect(new Set(ids).size).toBe(rig.bones.length);
  });
});
