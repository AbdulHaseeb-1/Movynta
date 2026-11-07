import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { EditorScene } from "@/features/assistant";
import type { BisectKeep } from "@/features/meshGeometry/meshBisect";
import { errorMessage, type SerialQueue } from "@/lib";
import { applyMeshTool, middleOfObject, previewMeshCut, type CutAxis, type CutSpec } from "./meshToolActions";
import { SegmentedChoice } from "./SegmentedChoice";
import type { ComponentChoice } from "./subdivideSelection";

/** The settings chosen for a plane cut. */
export interface CutChoice extends ComponentChoice {
  revision: number;
  faceSelection: boolean;
}
interface Props {
  scene: EditorScene;
  choice: CutChoice;
  saves: SerialQueue;
  close: () => void;
  onError: (message: string) => void;
  onCloseAutoFocus?: (event: Event) => void;
}

const AXES = [
  { value: "x", label: "X" },
  { value: "y", label: "Y" },
  { value: "z", label: "Z" },
] as const;
const SIDES = [
  { value: "both", label: "Cut only" },
  { value: "positive", label: "Keep + side" },
  { value: "negative", label: "Keep − side" },
] as const;

function startingOffset(scene: EditorScene, choice: ComponentChoice, axis: CutAxis): string {
  try {
    return String(middleOfObject(scene, choice, axis));
  } catch {
    return "0";
  }
}

/** Cut the mesh part with a plane at a world position, like Blender's Bisect, with a live account of what it would do. */
export function CutPlaneDialog({ scene, choice, saves, close, onError, onCloseAutoFocus }: Props) {
  const [axis, setAxis] = useState<CutAxis>("y");
  const [offset, setOffset] = useState(() => startingOffset(scene, choice, "y"));
  const [keep, setKeep] = useState<BisectKeep>("both");
  const [fill, setFill] = useState(false);
  const [facesOnly, setFacesOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState("");
  const spec = useMemo<CutSpec>(
    () => ({ axis, offset: offset.trim() === "" ? Number.NaN : Number(offset), keep, fill, facesOnly }),
    [axis, offset, keep, fill, facesOnly],
  );
  const preview = useMemo(() => previewMeshCut(scene, choice, choice.revision, spec), [scene, choice, spec]);
  const chooseAxis = (next: CutAxis) => {
    setAxis(next);
    setOffset(startingOffset(scene, choice, next));
  };
  const apply = () => {
    if (busy || !preview.ok) return;
    setBusy(true);
    setSaveError("");
    saves.run(
      async () => {
        try {
          await applyMeshTool(scene, choice, choice.revision, { type: "cut", spec });
          close();
        } finally {
          setBusy(false);
        }
      },
      (error) => {
        const message = errorMessage(error);
        setSaveError(message);
        onError(message);
      },
    );
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) close();
      }}
    >
      <DialogContent onCloseAutoFocus={onCloseAutoFocus}>
        <DialogTitle>Cut with a plane</DialogTitle>
        <DialogDescription>Cuts every face the plane crosses. The position is in scene coordinates.</DialogDescription>
        <SegmentedChoice label="Plane across axis" value={axis} options={AXES} onChange={chooseAxis} disabled={busy} />
        <label htmlFor="cut-offset" className="grid gap-2 text-sm">
          Position
          <Input
            id="cut-offset"
            type="number"
            step="any"
            value={offset}
            onChange={(event) => setOffset(event.target.value)}
          />
        </label>
        <SegmentedChoice label="Result" value={keep} options={SIDES} onChange={setKeep} disabled={busy} />
        <div className="flex items-center justify-between gap-3 text-sm">
          <span id="cut-cap">Cap the opening with flat faces</span>
          <Switch
            checked={fill && keep !== "both"}
            disabled={busy || keep === "both"}
            onCheckedChange={setFill}
            aria-labelledby="cut-cap"
          />
        </div>
        {choice.faceSelection && (
          <div className="flex items-center justify-between gap-3 text-sm">
            <span id="cut-faces">Only the selected faces</span>
            <Switch
              checked={facesOnly && keep === "both"}
              disabled={busy || keep !== "both"}
              onCheckedChange={setFacesOnly}
              aria-labelledby="cut-faces"
            />
          </div>
        )}
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {saveError || preview.message}
        </p>
        <p className="text-xs text-muted-foreground">
          The + side is the side the axis points to. Face numbers change after a cut. Review the result; Undo restores
          the mesh.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="outline" disabled={busy} onClick={close}>
            Cancel
          </Button>
          <Button disabled={busy || !preview.ok} onClick={apply}>
            Cut
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
