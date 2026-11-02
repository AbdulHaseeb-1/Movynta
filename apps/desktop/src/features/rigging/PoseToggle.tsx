import { Bone } from "lucide-react";
import { ToolButton } from "@/features/viewport3d";
import type { RigPosing } from "./useRigPosing";

interface PoseToggleProps {
  rigging: RigPosing;
  /** Which side the tooltip opens on, away from the bar. */
  tooltipSide: "left" | "top";
}

/** The toolbar button that turns posing on and off. It needs a selected model that has a rig. */
export function PoseToggle({ rigging, tooltipSide }: PoseToggleProps) {
  return (
    <ToolButton
      tooltipSide={tooltipSide}
      label="Pose bones"
      hint={rigging.rig ? "P" : "Select a model with a rig"}
      shortcut="P"
      active={rigging.posing}
      disabled={!rigging.rig}
      onClick={() => rigging.setPosing(!rigging.posing)}
    >
      <Bone className="size-[15px]" />
    </ToolButton>
  );
}
