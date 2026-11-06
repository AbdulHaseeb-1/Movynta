import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { EditorScene } from "@/features/assistant";
import { errorMessage, type SerialQueue } from "@/lib";
import { applyMeshTool } from "./meshToolActions";
import { SegmentedChoice } from "./SegmentedChoice";
import type { ComponentChoice } from "./subdivideSelection";

export interface ShadingChoice extends ComponentChoice { revision: number }
interface Props { scene: EditorScene; choice: ShadingChoice; saves: SerialQueue; close: () => void; onError: (message: string) => void }
type Look = "flat" | "smooth" | "angle";
const EXPLANATION: Record<Look, string> = {
  flat: "Every face gets its own shade, so the surface looks faceted.",
  smooth: "Faces blend at shared corners, so the whole surface looks rounded.",
  angle: "Faces blend across edges that bend less than the angle; sharper edges stay crisp.",
};
const LOOKS = [{ value: "flat", label: "Flat" }, { value: "smooth", label: "Smooth" }, { value: "angle", label: "Smooth by angle" }] as const;

/** Change how the mesh part is shaded without changing its shape. The choice is kept through later edits. */
export function ShadingDialog({ scene, choice, saves, close, onError }: Props) {
  const [look, setLook] = useState<Look>("angle");
  const [angle, setAngle] = useState("30");
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState("");
  const degrees = Number(angle);
  const invalid = look === "angle" && (angle.trim() === "" || !Number.isFinite(degrees) || degrees <= 0 || degrees >= 180);
  const apply = () => {
    if (busy || invalid) return;
    setBusy(true); setSaveError("");
    saves.run(async () => {
      try { await applyMeshTool(scene, choice, choice.revision, look === "angle" ? { type: "shade", mode: "smooth", angle: degrees } : { type: "shade", mode: look }); close(); }
      finally { setBusy(false); }
    }, (error) => { const message = errorMessage(error); setSaveError(message); onError(message); });
  };
  return <Dialog open onOpenChange={(open) => { if (!open && !busy) close(); }}>
    <DialogContent>
      <DialogTitle>Shading</DialogTitle>
      <DialogDescription>Changes how the surface is lit, not its shape.</DialogDescription>
      <SegmentedChoice label="Look" value={look} options={LOOKS} onChange={setLook} disabled={busy} />
      {look === "angle" && <label htmlFor="shade-angle" className="grid gap-2 text-sm">Angle in degrees<Input id="shade-angle" type="number" min="0" max="180" step="any" value={angle} onChange={(event) => setAngle(event.target.value)} /></label>}
      <p className="text-sm text-muted-foreground" aria-live="polite">{saveError || (invalid ? "Enter an angle above 0 and below 180." : EXPLANATION[look])}</p>
      <p className="text-xs text-muted-foreground">Face and vertex numbers do not change, and later edits keep this look. Undo restores the mesh.</p>
      <div className="flex justify-end gap-2"><Button variant="outline" disabled={busy} onClick={close}>Cancel</Button><Button disabled={busy || invalid} onClick={apply}>Apply</Button></div>
    </DialogContent>
  </Dialog>;
}
