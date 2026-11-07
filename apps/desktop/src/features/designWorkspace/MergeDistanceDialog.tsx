import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { EditorScene } from "@/features/assistant";
import { meshAtPath, modifierStack } from "@/features/meshGeometry";
import { readTopology } from "@/features/meshGeometry/meshTopology";
import { distanceGroups, mergeByDistance } from "@/features/meshGeometry/meshMergeDistance";
import { errorMessage, type SerialQueue } from "@/lib";
import { saveCageEdit } from "./saveCageEdit";

export interface DistanceChoice { objectId: string; meshPath: number[]; ids: string[]; revision: number }
interface Props { scene: EditorScene; choice: DistanceChoice; saves: SerialQueue; close: () => void; onError: (message: string) => void; onCloseAutoFocus?: (event: Event) => void }
export function MergeDistanceDialog({ scene, choice, saves, close, onError, onCloseAutoFocus }: Props) {
  const [distance, setDistance] = useState("0.001");
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState("");
  const value = Number(distance);
  const preview = useMemo(() => {
    try {
      if (!distance.trim() || !Number.isFinite(value) || value <= 0 || value > 100) throw new Error("Enter a distance greater than zero and at most 100.");
      if (scene.currentRevision !== choice.revision || scene.selection !== choice.objectId) throw new Error("The scene changed. Select the vertices again.");
      const mesh = meshAtPath(scene.getObject(choice.objectId), choice.meshPath);
      const modifiers = modifierStack(mesh)?.modifiers ?? [];
      if (modifiers.some((entry) => entry.enabled)) throw new Error("Disable modifiers before editing the base mesh.");
      if (modifiers.some((entry) => entry.kind === "extrusion")) throw new Error("Remove the live extrusion before changing topology.");
      const cage = readTopology(mesh.geometry), groups = distanceGroups(cage, choice.ids, value);
      if (!groups.length) return { count: 0, groups: 0, faces: 0, error: "", selection: [] as string[] };
      const result = mergeByDistance(cage, choice.ids, value, groups);
      return { count: groups.reduce((sum, group) => sum + group.length - 1, 0), groups: groups.length, faces: cage.faces.length - result.mesh.faces.length, error: "", selection: result.selection };
    } catch (error) { return { count: 0, groups: 0, faces: 0, error: errorMessage(error), selection: [] as string[] }; }
  }, [scene, choice, distance, value]);
  const apply = () => {
    if (busy || preview.count === 0 || preview.error) return;
    setBusy(true); setSaveError("");
    saves.run(async () => {
      try { await saveCageEdit(scene, { ...choice, selection: preview.selection, edit: { type: "geometry.merge_by_distance", ids: choice.ids, distance: value } }); close(); }
      finally { setBusy(false); }
    }, (error) => { const message = errorMessage(error); setSaveError(message); onError(message); });
  };
  return <Dialog open onOpenChange={(open) => { if (!open && !busy) close(); }}>
    <DialogContent onCloseAutoFocus={onCloseAutoFocus}>
      <DialogTitle>Merge by distance</DialogTitle>
      <DialogDescription>Merge nearby selected vertices into groups. Distance is measured in mesh-local units.</DialogDescription>
      <label htmlFor="merge-distance" className="grid gap-2 text-sm">Distance<Input id="merge-distance" type="number" min="0" max="100" step="any" value={distance} onChange={(event) => setDistance(event.target.value)} /></label>
      <p className="text-sm text-muted-foreground" aria-live="polite">{saveError || preview.error || `${preview.count} vertices will be removed across ${preview.groups} groups; ${preview.faces} collapsed faces will be removed.`}</p>
      <p className="text-xs text-muted-foreground">Vertices linked within the distance form a group, which moves to its average position. Review the result; Undo restores the mesh.</p>
      <div className="flex justify-end gap-2"><Button variant="outline" disabled={busy} onClick={close}>Cancel</Button><Button disabled={busy || preview.count === 0 || Boolean(preview.error)} onClick={apply}>Merge</Button></div>
    </DialogContent>
  </Dialog>;
}
