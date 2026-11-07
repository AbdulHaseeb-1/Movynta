import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { EditorScene } from "@/features/assistant";
import { meshAtPath, modifierStack } from "@/features/meshGeometry";
import { readTopology } from "@/features/meshGeometry/meshTopology";
import { correctNormals, type NormalCorrectionMode } from "@/features/meshGeometry/meshCorrectNormals";
import { errorMessage, type SerialQueue } from "@/lib";
import { saveCageEdit } from "./saveCageEdit";
import type { DistanceChoice } from "./MergeDistanceDialog";

interface Props {
  scene: EditorScene;
  choice: DistanceChoice;
  saves: SerialQueue;
  close: () => void;
  onError: (message: string) => void;
  onCloseAutoFocus?: (event: Event) => void;
}
/** The Mesh dialog that makes face normals consistent, with a preview before it is applied. */
export function CorrectNormalsDialog({ scene, choice, saves, close, onError, onCloseAutoFocus }: Props) {
  const [mode, setMode] = useState<NormalCorrectionMode>("consistent");
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState("");
  const preview = useMemo(() => {
    try {
      if (scene.currentRevision !== choice.revision || scene.selection !== choice.objectId)
        throw new Error("The scene changed. Select the mesh again.");
      const mesh = meshAtPath(scene.getObject(choice.objectId), choice.meshPath);
      const modifiers = modifierStack(mesh)?.modifiers ?? [];
      if (modifiers.some((entry) => entry.enabled)) throw new Error("Disable modifiers before editing the base mesh.");
      if (modifiers.some((entry) => entry.kind === "extrusion"))
        throw new Error("Remove the live extrusion before correcting normals.");
      const cage = readTopology(mesh.geometry);
      const result = correctNormals(cage, mode);
      const input = (mesh.geometry.index?.count ?? mesh.geometry.getAttribute("position").count) / 3;
      const omitted = Math.max(0, input - cage.faces.reduce((sum, face) => sum + face.length - 2, 0));
      return { ...result, omitted, error: "" };
    } catch (error) {
      return { flipped: 0, shells: 0, openShells: 0, omitted: 0, error: errorMessage(error) };
    }
  }, [scene, choice, mode]);
  const apply = () => {
    if (busy || preview.error) return;
    setBusy(true);
    setSaveError("");
    saves.run(
      async () => {
        try {
          await saveCageEdit(scene, { ...choice, selection: [], edit: { type: "geometry.correct_normals", mode } });
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
        <DialogTitle>Correct normals</DialogTitle>
        <DialogDescription>
          Correct face winding and rebuild shading normals on the whole selected mesh part.
        </DialogDescription>
        <div className="flex gap-2">
          <Button
            type="button"
            variant={mode === "consistent" ? "default" : "outline"}
            aria-pressed={mode === "consistent"}
            onClick={() => setMode("consistent")}
          >
            Consistent
          </Button>
          <Button
            type="button"
            variant={mode === "outward" ? "default" : "outline"}
            aria-pressed={mode === "outward"}
            onClick={() => setMode("outward")}
          >
            Outward for closed shells
          </Button>
        </div>
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {saveError ||
            preview.error ||
            `${preview.flipped} faces will flip across ${preview.shells} shells (${preview.openShells} open). ${preview.omitted} input triangles were omitted during cage reconstruction.`}
        </p>
        <p className="text-xs text-muted-foreground">
          Open shells keep the direction of their first face. Outward treats each closed shell separately, including
          cavity shells; inspect the result. Self-intersections are not checked. Authored shading normals are rebuilt.
          Use Undo to restore the mesh.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="outline" disabled={busy} onClick={close}>
            Cancel
          </Button>
          <Button disabled={busy || Boolean(preview.error)} onClick={apply}>
            Correct normals
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
