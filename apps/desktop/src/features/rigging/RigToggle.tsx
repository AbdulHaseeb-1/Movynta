import { Eye, EyeOff } from "lucide-react";
import { ToolButton } from "@/features/viewport3d";
import type { RigPosing } from "./useRigPosing";

interface RigToggleProps {
  rigging: RigPosing;
  /** Which side the tooltip opens on, away from the bar. */
  tooltipSide: "left" | "top";
}

/** The toolbar button that shows or hides the skeletons of every model that has one. */
export function RigToggle({ rigging, tooltipSide }: RigToggleProps) {
  // While posing the rig is always drawn, so the button reports that instead of a setting it cannot change.
  const shown = rigging.showRig || rigging.posing;
  return (
    <ToolButton
      tooltipSide={tooltipSide}
      label={shown ? "Hide rig" : "Show rig"}
      hint={rigging.hasRigs ? "" : "No model with a rig"}
      active={rigging.showRig}
      disabled={!rigging.hasRigs || rigging.posing}
      onClick={() => rigging.setShowRig(!rigging.showRig)}
    >
      {shown ? <Eye className="size-[15px]" /> : <EyeOff className="size-[15px]" />}
    </ToolButton>
  );
}
