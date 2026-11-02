import { Bone, Eye, EyeOff, Minus, Plus, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TransformFields } from "@/features/objectEditing";
import { cn } from "@/lib/utils";
import { MAX_IK_CHAIN } from "./riggingSlice";
import type { RigPosing } from "./useRigPosing";

interface RigPanelProps {
  rigging: RigPosing;
  /** True while the assistant is working; the rig is shown but cannot be posed. */
  disabled: boolean;
  className?: string;
}

/**
 * The selected model's skeleton: a list of its bones to choose from, whether to draw it, and the
 * chosen bone's exact values. It renders nothing for a selection without a rig, so the column it sits
 * in needs no knowledge of which models have one.
 */
export function RigPanel({ rigging, disabled, className }: RigPanelProps) {
  const { rig, bone, posing } = rigging;
  if (!rig) return null;

  return (
    <section
      aria-label="Rig"
      className={cn(
        "pointer-events-auto flex min-h-0 flex-col gap-2.5 rounded-xl bg-black/60 p-3 text-xs text-foreground shadow-2xl backdrop-blur-2xl backdrop-saturate-150",
        className,
      )}
    >
      {rigging.error && (
        <div role="alert" className="flex items-start gap-2 rounded-lg bg-popover p-2.5 leading-5 text-popover-foreground ring-1 ring-border">
          <p className="min-w-0 flex-1">{rigging.error}</p>
          <button
            type="button"
            onClick={rigging.dismissError}
            aria-label="Dismiss"
            className="grid size-5 shrink-0 place-items-center rounded-full text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}
      <header className="flex items-center gap-2">
        <Bone className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <h2 className="min-w-0 flex-1 truncate text-[13px] font-medium" title={rig.modelName}>
          Rig · {rig.bones.length} {rig.bones.length === 1 ? "bone" : "bones"}
        </h2>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => rigging.setShowRig(!rigging.showRig)}
          aria-label={rigging.showRig ? "Hide rig" : "Show rig"}
          aria-pressed={rigging.showRig}
          title={rigging.showRig ? "Hide rig" : "Show rig"}
          className="size-6 rounded-full text-muted-foreground hover:text-foreground"
        >
          {rigging.showRig ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
        </Button>
        <Button
          type="button"
          variant={posing ? "default" : "secondary"}
          size="sm"
          onClick={() => rigging.setPosing(!posing)}
          aria-pressed={posing}
          title="Pose bones (P)"
          className="h-6 rounded-full px-2.5 text-[11px]"
        >
          {posing ? "Posing" : "Pose"}
        </Button>
      </header>

      <ul aria-label="Bones" className="max-h-40 min-h-0 overflow-y-auto rounded-lg bg-foreground/[0.05] p-1">
        {rig.bones.map((item) => (
          <li key={item.index}>
            <button
              type="button"
              // A bone chosen in the view may be out of sight in the list; bring it into view.
              ref={(node) => {
                if (bone?.index === item.index) node?.scrollIntoView({ block: "nearest" });
              }}
              onClick={() => rigging.selectBone(bone?.index === item.index ? null : item.index)}
              aria-pressed={bone?.index === item.index}
              style={{ paddingLeft: 6 + Math.min(item.depth, 12) * 8 }}
              className={cn(
                "block w-full truncate rounded-md py-1 pr-2 text-left text-[12px] hover:bg-foreground/10 focus-visible:outline-2 focus-visible:outline-ring",
                bone?.index === item.index && "bg-brand/25 text-foreground",
              )}
            >
              {item.name}
            </button>
          </li>
        ))}
      </ul>

      {bone && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <h3 className="min-w-0 flex-1 truncate text-[12px] font-medium" title={bone.name}>
              {bone.name}
            </h3>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={rigging.resetBone}
              className="h-6 gap-1 rounded-full px-2 text-[11px] text-muted-foreground hover:text-foreground"
            >
              <RotateCcw className="size-3" />
              Reset bone
            </Button>
          </div>
          <TransformFields transform={bone.transform} disabled={disabled} onChange={rigging.updateBone} />
        </div>
      )}

      {posing && (
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 text-[11px] text-muted-foreground" title="With Move, this many bones above a joint bend to follow it. 0 moves the joint alone.">
            Move bends {rigging.ikChain === 0 ? "no bones above" : `${rigging.ikChain} ${rigging.ikChain === 1 ? "bone" : "bones"} above`}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Bend fewer bones"
            disabled={rigging.ikChain <= 0}
            onClick={() => rigging.setIkChain(rigging.ikChain - 1)}
            className="size-6 rounded-full text-muted-foreground hover:text-foreground"
          >
            <Minus className="size-3" />
          </Button>
          <span className="w-4 text-center text-[12px] tabular-nums">{rigging.ikChain}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Bend more bones"
            disabled={rigging.ikChain >= MAX_IK_CHAIN}
            onClick={() => rigging.setIkChain(rigging.ikChain + 1)}
            className="size-6 rounded-full text-muted-foreground hover:text-foreground"
          >
            <Plus className="size-3" />
          </Button>
        </div>
      )}

      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 text-[11px] leading-4 text-muted-foreground">
          {disabled
            ? "Wait for the assistant to finish to pose this rig."
            : posing
              ? "Click a joint to select it. Rotate turns it and everything below it; Move pulls it. Esc lets go, then leaves posing."
              : "Click any joint to start posing, or press P."}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={rigging.resetPose}
          className="h-6 shrink-0 rounded-full px-2 text-[11px] text-muted-foreground hover:text-foreground"
        >
          Reset pose
        </Button>
      </div>
    </section>
  );
}
