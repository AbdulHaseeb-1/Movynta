import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronRight, Circle, CornerDownRight, Eye, EyeOff, FolderOpen, Grid2x2, LocateFixed, Ruler, Settings2, Trash2, TriangleRight, X } from "lucide-react";
import { lengthUnits, metersPerUnit, savedMeasurementsSchema, type MeasurementAnnotation, type MeasurementRequest, type MeasurementResult, type ProjectMeasurements } from "@movynta/editor-protocol";
import type { EditorScene } from "@/features/assistant";
import type { Viewport } from "@/features/viewport3d";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BackendResponseError, backendRequest, errorMessage } from "@/lib/backend";
import { MeasurementOverlay } from "./MeasurementOverlay";
import { measureScene } from "@/features/assistant/measureScene";
import { useAppSelector } from "@/app/hooks";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { measurementCursor, pickMeasurementPoint, type MeasurementSnap } from "./measurementPicking";

interface Props {
  scene: EditorScene;
  viewport: Viewport;
  projectId: string | undefined;
  disabled: boolean;
  onPickingChange: (active: boolean) => void;
}
const numberText = (value: number) => new Intl.NumberFormat(undefined, { maximumSignificantDigits: 6 }).format(value);

export function MeasurementPanel({ scene, viewport, projectId, disabled, onPickingChange }: Props) {
  const [saved, setSaved] = useState<{ version: number; value: ProjectMeasurements } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [reloadAvailable, setReloadAvailable] = useState(false);
  const loadController = useRef<AbortController | null>(null);
  const [selection, setSelection] = useState<readonly string[]>([]);
  const [space, setSpace] = useState<"world" | "local">("world");
  const [tool, setTool] = useState<"distance" | "angle" | null>(null);
  const [points, setPoints] = useState<number[][]>([]);
  const [hover, setHover] = useState<number[] | null>(null);
  const [snap, setSnap] = useState<MeasurementSnap>("surface");
  const [showAnnotations, setShowAnnotations] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [savedOpen, setSavedOpen] = useState(true);
  const [draft, setDraft] = useState<MeasurementAnnotation | null>(null);
  const [calibration, setCalibration] = useState("1");
  const [dimensions, setDimensions] = useState<MeasurementResult | null>(null);
  const [clearance, setClearance] = useState<MeasurementResult | null>(null);
  const [edgeLength, setEdgeLength] = useState<MeasurementResult | null>(null);
  const { mode, componentKind, componentSelection } = useAppSelector((state) => state.designWorkspace);
  useEffect(() => {
    onPickingChange(tool !== null && !disabled);
    return () => onPickingChange(false);
  }, [tool, disabled, onPickingChange]);
  useEffect(() => {
    const sync = () => {
      const ids = scene.selectedIds;
      const active = ids[ids.length - 1];
      setSelection(ids);
      setClearance(null);
      setEdgeLength(null);
      setTool(null);
      setPoints([]);
      setDimensions(!disabled && active ? scene.measure({ kind: "dimensions", target: { objectId: active }, space }) : null);
    };
    sync();
    return scene.onChange(sync);
  }, [scene, space, disabled]);
  const loadMeasurements = useCallback(async () => {
    if (!projectId) return;
    loadController.current?.abort();
    const controller = new AbortController();
    loadController.current = controller;
    setLoading(true);
    setReloadAvailable(false);
    setError("");
    try {
      const loaded = await backendRequest(`/projects/${projectId}/measurements`, savedMeasurementsSchema, "GET", undefined, AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]));
      if (controller.signal.aborted) return;
      setSaved(loaded);
      scene.setMeasurementUnits(loaded.value.units, loaded.value.annotations);
      setCalibration(String(loaded.value.units?.metersPerSceneUnit ?? 1));
    } catch (failure) {
      if (!controller.signal.aborted) { setError(errorMessage(failure)); setReloadAvailable(true); }
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [projectId, scene]);
  useEffect(() => {
    scene.setMeasurementUnits(null);
    // Loading is tied to the active project and must also run when that project first appears.
    // eslint-disable-next-line react/set-state-in-effect
    void loadMeasurements();
    return () => { loadController.current?.abort(); };
  }, [scene, loadMeasurements]);
  const units = saved?.value.units ?? null;
  const length = useCallback((value: number) => units
    ? `${numberText(value * units.metersPerSceneUnit / metersPerUnit[units.display])} ${units.display}`
    : `${numberText(value)} units`, [units]);
  async function save(value: ProjectMeasurements, clearDraft = false) {
    if (!projectId || !saved || busy || loading || reloadAvailable || disabled) return;
    setBusy(true); setError("");
    try {
      const next = await backendRequest(`/projects/${projectId}/measurements`, savedMeasurementsSchema, "PATCH", { expectedVersion: saved.version, value });
      setSaved(next);
      scene.setMeasurementUnits(next.value.units, next.value.annotations);
      setCalibration(String(next.value.units?.metersPerSceneUnit ?? 1));
      if (clearDraft) setDraft(null);
    } catch (failure) {
      setError(errorMessage(failure));
      if (failure instanceof BackendResponseError && failure.status === 409) setReloadAvailable(true);
    }
    finally { setBusy(false); }
  }
  useEffect(() => {
    if (!tool || disabled || busy) return undefined;
    const dom = viewport.renderer.domElement;
    const restoreCursor = measurementCursor(viewport);
    const pick = (event: PointerEvent) => pickMeasurementPoint(
      viewport, scene, event.clientX, event.clientY,
      event.altKey ? "grid" : event.shiftKey ? "vertex" : snap,
    );
    let frame: number | undefined;
    const move = (event: PointerEvent) => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = undefined;
      if (event.target !== dom) { setHover(null); return; }
      frame = requestAnimationFrame(() => {
        frame = undefined;
        setHover(pick(event)?.toArray() ?? null);
      });
    };
    const click = (event: PointerEvent) => {
      if (event.target !== dom || (event.button !== 0 && event.button !== 2)) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (event.button === 2) { setTool(null); setPoints([]); setHover(null); return; }
      const chosen = pick(event);
      if (!chosen) { setError("Pick a visible surface, or hold Alt to pick the ground grid."); return; }
      setError("");
      const next = [...points, chosen.toArray()];
      if (tool === "angle" && next.length === 2 && points[0]?.every((value, i) => value === chosen.getComponent(i))) {
        setError("Choose a different point for the corner.");
        return;
      }
      setHover(null);
      if (next.length === (tool === "angle" ? 3 : 2)) {
        if (tool === "angle") {
          const [from, at, to] = next;
          if (!from || !at || !to) return;
          const angle = measureScene({ kind: "angle", from, at, to }, () => undefined, 0);
          if (angle.status !== "ok") { setError(angle.message); return; }
        }
        setDraft({ id: `m_${crypto.randomUUID()}`, name: tool === "angle" ? "Angle" : "Distance", points: next });
        setTool(null); setPoints([]);
      } else setPoints(next);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.stopImmediatePropagation(); setTool(null); setPoints([]); }
    };
    window.addEventListener("pointerdown", click, true);
    window.addEventListener("pointermove", move);
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("pointerdown", click, true);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("keydown", key, true);
      if (frame !== undefined) cancelAnimationFrame(frame);
      restoreCursor();
    };
  }, [tool, points, snap, viewport, scene, disabled, busy]);
  function measureGap(method: "bounds" | "surface") {
    const [first, second] = scene.selectedIds;
    if (!first || !second || disabled) return;
    setClearance(scene.measure({ kind: "clearance", first: { objectId: first }, second: { objectId: second }, method }));
  }
  function measureEdge() {
    const context = scene.context();
    const picked = context.designFocus.componentSelection;
    const edge = picked?.ids[0];
    if (!picked || picked.kind !== "edge" || picked.ids.length !== 1 || !edge) return;
    setEdgeLength(scene.measure({ kind: "edge", objectId: picked.objectId, meshPath: picked.meshPath, edge, revision: context.revision, view: "evaluated" }));
  }
  const annotationValue = useCallback((annotation: MeasurementAnnotation) => {
    const [from, at, to] = annotation.points;
    if (!from || !at) return "";
    const pending = annotation.id === "pending";
    if (pending && annotation.name === "Angle" && !to) return "";
    const request: MeasurementRequest = to ? { kind: "angle", from, at, to } : { kind: "distance", from, to: at };
    const result = measureScene(request, () => undefined, 0);
    if (result.status !== "ok") return pending ? "" : result.message;
    if (result.data.kind === "angle") return `${numberText(result.data.degrees)}°`;
    return result.data.kind === "distance" ? length(result.data.length) : "";
  }, [length]);
  const annotations = useMemo(() => [...(saved?.value.annotations ?? []), ...(draft ? [draft] : [])], [saved, draft]);
  const visibleAnnotations = useMemo(() => showAnnotations ? annotations : draft ? [draft] : [], [annotations, showAnnotations, draft]);
  useEffect(() => {
    const overlay = new MeasurementOverlay(viewport, visibleAnnotations, annotationValue);
    return () => overlay.dispose();
  }, [viewport, visibleAnnotations, annotationValue]);
  useEffect(() => {
    if (!tool || disabled) return undefined;
    const preview = [...points, ...(hover ? [hover] : [])];
    const overlay = new MeasurementOverlay(viewport,
      preview.length ? [{ id: "pending", name: tool === "angle" ? "Angle" : "Distance", points: preview }] : [],
      annotationValue,
    );
    return () => overlay.dispose();
  }, [viewport, tool, disabled, points, hover, annotationValue]);
  const locked = disabled || busy || loading || reloadAvailable || !saved;
  function start(next: "distance" | "angle") {
    scene.measure({ kind: "distance", from: [0, 0, 0], to: [0, 0, 0] });
    setTool((current) => current === next ? null : next);
    setPoints([]);
    setHover(null);
    setError("");
  }
  const livePoints = [...points, ...(hover ? [hover] : [])];
  const liveValue = tool && livePoints.length === (tool === "angle" ? 3 : 2)
    ? annotationValue({ id: "pending", name: tool === "angle" ? "Angle" : "Distance", points: livePoints }) : null;
  const activeName = selection.length ? scene.getObject(selection[selection.length - 1] ?? "")?.name : undefined;
  return (
    <section aria-label="Measurements" className="pointer-events-auto w-full overflow-hidden rounded-xl border border-border bg-card/95 text-xs shadow-xl">
      <header className="flex items-center justify-between border-b border-border px-3 py-2.5">
        <h2 className="flex items-center gap-2 font-medium"><Ruler className="size-3.5 text-muted-foreground" /> Measure</h2>
        <Select disabled={locked} value={units?.display ?? "unitless"} onValueChange={(display) => {
          if (!saved) return;
          const unit = lengthUnits.find((item) => item === display);
          void save({ ...saved.value, units: unit ? { display: unit, metersPerSceneUnit: units?.metersPerSceneUnit ?? 1 } : null });
        }}>
          <SelectTrigger aria-label="Measurement display units" className="h-6 w-20 border-transparent bg-secondary px-2 text-[11px] shadow-none"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="unitless">Units</SelectItem>{lengthUnits.map((unit) => <SelectItem key={unit} value={unit}>{unit}</SelectItem>)}</SelectContent>
        </Select>
      </header>

      <div className="p-2.5">
        <div aria-label="Measurement tools" className="grid grid-cols-2 gap-1 rounded-lg bg-background p-1">
          <Button size="sm" variant={tool === "distance" ? "secondary" : "ghost"} aria-pressed={tool === "distance"} disabled={disabled || busy} className="h-8 gap-2" onClick={() => start("distance")}><Ruler className="size-3.5" /> Distance</Button>
          <Button size="sm" variant={tool === "angle" ? "secondary" : "ghost"} aria-pressed={tool === "angle"} disabled={disabled || busy} className="h-8 gap-2" onClick={() => start("angle")}><TriangleRight className="size-3.5" /> Angle</Button>
        </div>
        {tool ? (
          <div className="mt-2 rounded-lg border border-border bg-muted/50 p-2.5">
            <div className="flex items-center justify-between gap-2">
              <output className="font-medium">{tool === "angle" ? ["Pick first point", "Pick the corner", "Pick final point"][points.length] : points.length ? "Pick end point" : "Pick start point"}</output>
              <Button variant="ghost" size="icon-sm" className="size-5" aria-label="Cancel measurement" onClick={() => { setTool(null); setPoints([]); setHover(null); }}><X className="size-3" /></Button>
            </div>
            <div className="mt-2 flex items-center gap-1.5" aria-label={"Point " + (points.length + 1) + " of " + (tool === "angle" ? 3 : 2)}>
              {Array.from({ length: tool === "angle" ? 3 : 2 }, (_, i) => i + 1).map((step) => (
                <span key={step} className={cn("flex size-5 items-center justify-center rounded-full border text-[10px]", step <= points.length ? "border-foreground bg-foreground text-background" : step === points.length + 1 ? "border-foreground text-foreground" : "border-border text-muted-foreground")}>
                  {step <= points.length ? <Check className="size-3" /> : step}
                </span>
              ))}
              <span className="ml-auto text-[10px] text-muted-foreground">Esc to cancel</span>
            </div>
            {liveValue && <output aria-live="off" className="mt-2 block font-mono text-base font-medium tabular-nums">{liveValue}</output>}
          </div>
        ) : !draft && (
          <p className="px-1 pt-2 text-[11px] leading-4 text-muted-foreground">Choose a tool, then pick points in the viewport.</p>
        )}
        <div className="mt-2 flex items-center gap-1">
          <span className="mr-auto pl-1 text-[10px] text-muted-foreground">Snap</span>
          {([
            ["surface", "Surface", Circle], ["vertex", "Vertex", LocateFixed], ["grid", "Grid", Grid2x2],
          ] as const).map(([value, label, Icon]) => (
            <Button key={value} variant={snap === value ? "secondary" : "ghost"} size="icon-sm" aria-label={"Snap to " + label.toLowerCase()} aria-pressed={snap === value} title={label + (value === "vertex" ? " · hold Shift" : value === "grid" ? " · hold Alt" : "")} onClick={() => setSnap(value)} className="size-7"><Icon className="size-3.5" /></Button>
          ))}
          <span className="ml-1 w-10 text-[10px] text-muted-foreground">{snap === "surface" ? "Surface" : snap === "vertex" ? "Vertex" : "Grid"}</span>
        </div>
      </div>

      {draft && (
        <div className="mx-2.5 mb-2.5 rounded-lg border border-border bg-background p-2.5">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">New measurement</span>
            <Button size="icon-sm" variant="ghost" className="size-5" aria-label="Discard new measurement" onClick={() => setDraft(null)}><X className="size-3" /></Button>
          </div>
          <output className="mb-2 block font-mono text-lg font-medium tabular-nums">{annotationValue(draft)}</output>
          <div className="flex gap-1.5">
            <Input aria-label="Measurement name" value={draft.name} maxLength={80} onChange={(event) => setDraft({ ...draft, name: event.target.value })} className="h-7 min-w-0 bg-card text-xs" />
            <Button size="sm" className="h-7 px-2" disabled={locked || !draft.name.trim() || (saved?.value.annotations.length ?? 0) >= 50} onClick={() => { if (saved) void save({ ...saved.value, annotations: [...saved.value.annotations, draft] }, true); }}><Check className="size-3" /> Save</Button>
          </div>
          {!projectId && <p className="mt-2 text-[10px] text-muted-foreground">Add a shape or open a project to save this measurement.</p>}
        </div>
      )}

      <div className="border-t border-border px-3 py-2.5">
        <div className="mb-2 flex items-center gap-2">
          <h3 className="min-w-0 flex-1 truncate font-medium" title={activeName}>{activeName || "Selection"}</h3>
          <div className="flex rounded bg-background p-0.5" aria-label="Dimension axes">
            {(["world", "local"] as const).map((value) => <Button key={value} size="sm" variant={space === value ? "secondary" : "ghost"} aria-pressed={space === value} onClick={() => setSpace(value)} className="h-5 px-1.5 text-[10px] capitalize">{value}</Button>)}
          </div>
        </div>
        {dimensions?.status === "ok" && dimensions.data.kind === "dimensions" ? (
          <dl className="space-y-1">
            {["X", "Y", "Z"].map((axis, i) => (
              <div key={axis} className="flex items-center justify-between gap-3 rounded bg-background/60 px-2 py-1.5">
                <dt className="text-[10px] text-muted-foreground">{axis} <span className="ml-1">dimension</span></dt>
                <dd className="font-mono text-[11px] tabular-nums">{length(dimensions.data.kind === "dimensions" ? dimensions.data.size[i] ?? 0 : 0)}</dd>
              </div>
            ))}
          </dl>
        ) : <p className="text-[11px] leading-4 text-muted-foreground">{dimensions?.status === "unavailable" ? dimensions.message : "Select an object to inspect its dimensions."}</p>}
        {mode === "edit" && componentKind === "edge" && componentSelection?.ids.length === 1 && <Button size="sm" className="mt-2 h-7 w-full" variant="outline" disabled={disabled} onClick={measureEdge}><CornerDownRight className="size-3" /> Read selected edge</Button>}
        {edgeLength && <output className="mt-2 block font-mono text-[11px]">{edgeLength.status === "ok" && edgeLength.data.kind === "distance" ? "Edge · " + length(edgeLength.data.length) : edgeLength.status === "unavailable" ? edgeLength.message : ""}</output>}
        {selection.length === 2 && (
          <div className="mt-2">
            <p className="mb-1.5 text-[10px] text-muted-foreground">Clearance between 2 objects</p>
            <div className="grid grid-cols-2 gap-1">
              <Button size="sm" className="h-7" variant="outline" disabled={disabled} onClick={() => measureGap("bounds")}>Bounds gap</Button>
              <Button size="sm" className="h-7" variant="outline" disabled={disabled} onClick={() => measureGap("surface")}>Surface gap</Button>
            </div>
            {clearance && <output className="mt-2 block font-mono text-sm">{clearance.status === "ok" && clearance.data.kind === "clearance" ? length(clearance.data.distance) : clearance.status === "unavailable" ? clearance.message : ""}</output>}
          </div>
        )}
      </div>

      <Collapsible open={savedOpen} onOpenChange={setSavedOpen} className="border-t border-border">
        <div className="flex items-center px-2.5 py-1.5">
          <CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-1.5 rounded py-1 text-left font-medium focus-visible:outline-2 focus-visible:outline-ring">
            <ChevronRight className={cn("size-3 text-muted-foreground transition-transform", savedOpen && "rotate-90")} />
            Saved <span className="ml-1 text-[10px] font-normal text-muted-foreground">{saved?.value.annotations.length ?? 0}</span>
          </CollapsibleTrigger>
          <Button size="icon-sm" variant="ghost" className="size-6" disabled={!saved?.value.annotations.length} aria-label={showAnnotations ? "Hide saved measurements in viewport" : "Show saved measurements in viewport"} aria-pressed={showAnnotations} title={showAnnotations ? "Hide in viewport" : "Show in viewport"} onClick={() => setShowAnnotations((show) => !show)}>{showAnnotations ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}</Button>
        </div>
        <CollapsibleContent>
          <div className="max-h-44 overflow-y-auto px-2.5 pb-2.5">
            {saved?.value.annotations.length ? saved.value.annotations.map((annotation) => (
              <div key={annotation.id} className="group flex items-center gap-2 rounded px-1.5 py-1.5 hover:bg-accent/50">
                {annotation.points.length === 3 ? <TriangleRight className="size-3 shrink-0 text-muted-foreground" /> : <Ruler className="size-3 shrink-0 text-muted-foreground" />}
                <span className="min-w-0 flex-1 truncate text-[11px]" title={annotation.name}>{annotation.name}</span>
                <span className="shrink-0 font-mono text-[11px] tabular-nums">{annotationValue(annotation)}</span>
                <Button size="icon-sm" className="size-5 shrink-0 text-muted-foreground opacity-40 group-hover:opacity-100 focus-visible:opacity-100" variant="ghost" disabled={locked} aria-label={"Delete " + annotation.name} onClick={() => { if (saved) void save({ ...saved.value, annotations: saved.value.annotations.filter((item) => item.id !== annotation.id) }); }}><Trash2 className="size-3" /></Button>
              </div>
            )) : <div className="flex items-start gap-2 rounded-lg border border-dashed border-border px-2.5 py-3 text-muted-foreground"><FolderOpen className="mt-0.5 size-3.5 shrink-0" /><p className="text-[11px] leading-4">{saved ? "Save a distance or angle to keep it in this project." : reloadAvailable ? "Measurements could not be loaded." : projectId ? "Loading project measurements…" : "Open a project to keep measurements."}</p></div>}
            {Boolean(saved?.value.annotations.length) && <p className="mt-2 px-1 text-[10px] text-muted-foreground">Annotations mark fixed points in the scene.</p>}
          </div>
        </CollapsibleContent>
      </Collapsible>

      <Collapsible open={settingsOpen} onOpenChange={setSettingsOpen} className="border-t border-border">
        <CollapsibleTrigger className="flex w-full items-center gap-1.5 px-3 py-2.5 text-[11px] text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
          <ChevronRight className={cn("size-3 transition-transform", settingsOpen && "rotate-90")} /><Settings2 className="size-3" /> Scene scale
          <span className="ml-auto font-mono text-[10px]">{units ? "1 unit = " + numberText(units.metersPerSceneUnit) + " m" : "Unitless"}</span>
        </CollapsibleTrigger>
        <CollapsibleContent className="px-3 pb-3">
          <p className="mb-2 text-[11px] leading-4 text-muted-foreground">Choose display units above, then calibrate the scale of this project.</p>
          {units && <div>
            <label htmlFor="measurement-calibration" className="text-[10px] text-muted-foreground">Meters per scene unit</label>
            <div className="mt-1 flex gap-1.5">
              <Input id="measurement-calibration" inputMode="decimal" value={calibration} onChange={(event) => setCalibration(event.target.value)} className="h-7 bg-background font-mono text-xs" />
              <Button size="sm" variant="secondary" className="h-7" disabled={locked || !(Number(calibration) >= 1e-9 && Number(calibration) <= 1e9)} onClick={() => { if (saved) void save({ ...saved.value, units: { ...units, metersPerSceneUnit: Number(calibration) } }); }}>Apply</Button>
            </div>
            <p className="mt-2 text-[10px] leading-4 text-muted-foreground">Check imported model scale before using real-world dimensions.</p>
          </div>}
        </CollapsibleContent>
      </Collapsible>
      {busy && <output className="block border-t border-border px-3 py-2 text-[10px] text-muted-foreground">Saving measurement settings…</output>}
      {error && <p role="alert" className="border-t border-border px-3 py-2 text-[11px] leading-4 text-destructive">{error}</p>}
      {reloadAvailable && <div className="px-3 pb-2"><Button size="sm" variant="outline" disabled={loading || busy} onClick={() => void loadMeasurements()}>Reload measurements</Button><p className="mt-1 text-[10px] text-muted-foreground">Review the latest settings before saving again. A new measurement draft will be kept.</p></div>}
    </section>
  );
}
