import { MAX_COMMANDS_PER_PROPOSAL } from "@movynta/editor-protocol";
import type { ObjectTransform } from "@/features/assistant";
import { sameTransform } from "@/features/objectEditing";
import { poseOf, type Rig } from "./rig";

/** The command that sets one bone's local transform; see `poseBoneCommandSchema` in the protocol. */
export interface PoseCommand {
  commandId: string;
  type: "rig.pose_bone";
  objectId: string;
  bone: number;
  transform: ObjectTransform;
}

/** Commands that change a pose, and the commands that put it back. */
export interface PoseBatch {
  commands: PoseCommand[];
  undo: PoseCommand[];
}

export function poseCommand(objectId: string, bone: number, transform: ObjectTransform): PoseCommand {
  return { commandId: `pose-${bone}`, type: "rig.pose_bone", objectId, bone, transform };
}

/**
 * The batches that put every bone that has moved back where the model file had it. A batch holds at
 * most {@link MAX_COMMANDS_PER_PROPOSAL} commands, so a large rig takes several. Empty when nothing has moved.
 */
export function restoreBatches(objectId: string, rig: Rig): PoseBatch[] {
  const commands: PoseCommand[] = [];
  const undo: PoseCommand[] = [];
  rig.bones.forEach((bone, index) => {
    const rest = rig.rest[index];
    const now = poseOf(bone);
    if (!rest || sameTransform(now, rest)) return;
    commands.push(poseCommand(objectId, index, rest));
    undo.push(poseCommand(objectId, index, now));
  });
  const batches: PoseBatch[] = [];
  for (let from = 0; from < commands.length; from += MAX_COMMANDS_PER_PROPOSAL)
    batches.push({
      commands: commands.slice(from, from + MAX_COMMANDS_PER_PROPOSAL),
      undo: undo.slice(from, from + MAX_COMMANDS_PER_PROPOSAL),
    });
  return batches;
}
