import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { EditorScene } from "@/features/assistant";
import { meshAtPath, modifierStack } from "@/features/meshGeometry";
import { readTopology } from "@/features/meshGeometry/meshTopology";
import { removeDuplicateFaces } from "@/features/meshGeometry/meshDuplicateFaces";
import { errorMessage, type SerialQueue } from "@/lib";
import { saveCageEdit } from "./saveCageEdit";
import type { DistanceChoice } from "./MergeDistanceDialog";

interface Props { scene: EditorScene; choice: DistanceChoice; saves: SerialQueue; close: () => void; onError: (message: string) => void; onCloseAutoFocus?: (event: Event) => void }
export function DuplicateFacesDialog({ scene, choice, saves, close, onError, onCloseAutoFocus }: Props) {
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState("");
  const preview = useMemo(() => {
    try {
      if (scene.currentRevision !== choice.revision || scene.selection !== choice.objectId) throw new Error("The scene changed. Select the mesh again.");
      const mesh = meshAtPath(scene.getObject(choice.objectId), choice.meshPath);
      const modifiers = modifierStack(mesh)?.modifiers ?? [];
      if (modifiers.some((entry) => entry.enabled)) throw new Error("Disable modifiers before editing the base mesh.");
      if (modifiers.some((entry) => entry.kind === "extrusion")) throw new Error("Remove the live extrusion before changing topology.");
      const cage = readTopology(mesh.geometry);
      const inputTriangles = (mesh.geometry.index?.count ?? mesh.geometry.getAttribute("position").count) / 3;
      const cageTriangles = cage.faces.reduce((total, face) => total + face.length - 2, 0);
      const omitted = Math.max(0, inputTriangles - cageTriangles);
      const result = removeDuplicateFaces(cage, mesh.geometry);
      return { removed: result.removed, omitted, error: "" };
    } catch (error) { return { removed: 0, omitted: 0, error: errorMessage(error) }; }
  }, [scene, choice]);
  const apply = () => {
    if (busy || !preview.removed || preview.error) return;
    setBusy(true); setSaveError("");
    saves.run(async () => {
      try { await saveCageEdit(scene, { ...choice, selection: [], edit: { type: "geometry.remove_duplicate_faces" } }); close(); }
      finally { setBusy(false); }
    }, (error) => { const message = errorMessage(error); setSaveError(message); onError(message); });
  };
  return <Dialog open onOpenChange={(open) => { if (!open && !busy) close(); }}>
    <DialogContent onCloseAutoFocus={onCloseAutoFocus}>
      <DialogTitle>Remove duplicate faces</DialogTitle>
      <DialogDescription>Inspect the whole selected mesh part for faces with the same orientation, material and attributes.</DialogDescription>
      <p className="text-sm text-muted-foreground" aria-live="polite">{saveError || preview.error || `${preview.removed} duplicate faces will be removed. ${preview.omitted} input triangles were omitted when reconstructing the editable cage.`}</p>
      <p className="text-xs text-muted-foreground">Ambiguous overlaps and invalid results are rejected. The mesh is rebuilt from its editable cage. Use Undo to restore it.</p>
      <div className="flex justify-end gap-2"><Button variant="outline" disabled={busy} onClick={close}>Cancel</Button><Button disabled={busy || !preview.removed || Boolean(preview.error)} onClick={apply}>Remove duplicates</Button></div>
    </DialogContent>
  </Dialog>;
}
