import { useEffect, useMemo, useState } from "react";
import type { Mesh } from "three";
import type { MeshModifierSpec } from "@movynta/editor-protocol";
import { modifierListSchema } from "@movynta/editor-protocol";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Eye,
  EyeOff,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAppSelector } from "@/app/hooks";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrubNumberInput } from "./ScrubNumberInput";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { EditorScene } from "@/features/assistant";
import { modifierStack } from "@/features/meshGeometry/modifierStack";
import { errorMessage, type SerialQueue } from "@/lib";
import { saveModifiers } from "./manualModifiers";
import { listedPath, partsOf, pathFrom, pathValue, type OperandChoice } from "./meshParts";
import { saveManualCommands } from "./saveManualCommands";

interface ModifierPanelProps {
  scene: EditorScene | null;
  saves: SerialQueue;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
}
const SUBDIVISION_METHODS = [
  { value: "catmull-clark", label: "Catmull–Clark" },
  { value: "linear", label: "Linear" },
  { value: "loop", label: "Loop" },
] as const;
const BEVEL_PROFILES = [
  { value: "circular", label: "Circular" },
  { value: "round", label: "Round" },
  { value: "chamfer", label: "Chamfer" },
] as const;
const BEVEL_ANGLES = [
  { value: "0", label: "All creases" },
  { value: "15", label: "Mild 15°" },
  { value: "30", label: "Sharp 30°" },
  { value: "60", label: "Hard 60°" },
] as const;
const BOOLEAN_OPERATIONS = [
  { value: "difference", label: "Difference" },
  { value: "union", label: "Union" },
  { value: "intersect", label: "Intersect" },
] as const;
type SubdivisionMethod = (typeof SUBDIVISION_METHODS)[number]["value"];
type BevelProfile = (typeof BEVEL_PROFILES)[number]["value"];
type BooleanOperation = (typeof BOOLEAN_OPERATIONS)[number]["value"];
function isSubdivisionMethod(value: string): value is SubdivisionMethod {
  return SUBDIVISION_METHODS.some((method) => method.value === value);
}
function isBevelProfile(value: string): value is BevelProfile {
  return BEVEL_PROFILES.some((profile) => profile.value === value);
}
function isBooleanOperation(value: string): value is BooleanOperation {
  return BOOLEAN_OPERATIONS.some((operation) => operation.value === value);
}
function modifierName(kind: MeshModifierSpec["kind"]): string {
  if (kind === "bevel") return "Bevel";
  if (kind === "extrusion") return "Extrusion";
  if (kind === "boolean") return "Boolean";
  return "Subdivision";
}
function angleChoices(angle: number): { value: string; label: string }[] {
  const value = String(angle);
  if (BEVEL_ANGLES.some((choice) => choice.value === value)) return [...BEVEL_ANGLES];
  return [...BEVEL_ANGLES, { value, label: `${angle}°` }];
}
function BooleanFields(props: {
  entry: Extract<MeshModifierSpec, { kind: "boolean" }>;
  index: number;
  locked: boolean;
  operands: readonly OperandChoice[];
  materialSlots: readonly { id: string; label: string }[];
  onChange: (next: MeshModifierSpec) => void;
  cutterVisible: boolean | undefined;
  onCutterVisibility: (visible: boolean) => void;
  visibilityLocked: boolean;
}) {
  const listed = props.operands.some((operand) => operand.objectId === props.entry.operandObjectId)
    ? props.operands
    : [...props.operands, { objectId: props.entry.operandObjectId, name: props.entry.operandObjectId, parts: [] }];
  const chosen = listed.find((operand) => operand.objectId === props.entry.operandObjectId);
  return (
    <div className="grid gap-2">
      <div className="grid gap-1 text-[11px] text-muted-foreground">
        <span>Operation</span>
        <Select value={props.entry.operation} disabled={props.locked} onValueChange={(value) => {
          if (isBooleanOperation(value)) props.onChange({ ...props.entry, operation: value });
        }}>
          <SelectTrigger className="h-8 text-xs" aria-label={`Boolean operation ${props.index + 1}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {BOOLEAN_OPERATIONS.map((operation) => (
              <SelectItem key={operation.value} value={operation.value}>{operation.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {props.cutterVisible !== undefined && (
        <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span>{props.cutterVisible ? "Cutter visible · may cover the cut" : "Cutter hidden"}</span>
          <Button type="button" size="icon-sm" variant="ghost" className="size-6 [&_svg]:size-3"
            aria-label={props.cutterVisible ? "Hide Boolean cutter" : "Show Boolean cutter"}
            title={props.cutterVisible ? "Hide cutter to see the cut" : "Show cutter"}
            disabled={props.locked || props.visibilityLocked} onClick={() => props.onCutterVisibility(!props.cutterVisible)}>
            {props.cutterVisible ? <Eye /> : <EyeOff />}
          </Button>
        </div>
      )}
      <div className="grid gap-1 text-[11px] text-muted-foreground">
        <span>Operand</span>
        <Select value={props.entry.operandObjectId} disabled={props.locked} onValueChange={(value) => {
          const first = listed.find((operand) => operand.objectId === value)?.parts[0];
          if (first) props.onChange({ ...props.entry, operandObjectId: value, operandMeshPath: first.path });
        }}>
          <SelectTrigger className="h-8 text-xs" aria-label={`Boolean operand ${props.index + 1}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {listed.map((operand) => (
              <SelectItem key={operand.objectId} value={operand.objectId}>{operand.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {chosen && chosen.parts.length > 1 && (
        <div className="grid gap-1 text-[11px] text-muted-foreground">
          <span>Mesh part</span>
          <Select value={pathValue(listedPath(chosen, props.entry.operandMeshPath))} disabled={props.locked} onValueChange={(value) => {
            props.onChange({ ...props.entry, operandMeshPath: pathFrom(value) });
          }}>
            <SelectTrigger className="h-8 text-xs" aria-label={`Boolean mesh part ${props.index + 1}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {chosen.parts.map((part) => (
                <SelectItem key={pathValue(part.path)} value={pathValue(part.path)}>{part.mesh.name || (part.path.length === 0 ? "Object" : `Part ${pathValue(part.path)}`)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      {(props.materialSlots.length > 1 || props.entry.cutMaterialIndex !== undefined) && (
        <div className="grid gap-1 text-[11px] text-muted-foreground">
          <span>Cutter surface material</span>
          <Select value={props.entry.cutMaterialIndex === undefined ? "source" : String(props.entry.cutMaterialIndex)}
            disabled={props.locked} onValueChange={(value) => {
              const { cutMaterialIndex: previous, ...entry } = props.entry;
              if (value === "source") {
                if (previous !== undefined) props.onChange(entry);
              } else {
                props.onChange({ ...entry, cutMaterialIndex: Number(value) });
              }
            }}>
            <SelectTrigger className="h-8 text-xs" aria-label={`Boolean cutter surface material ${props.index + 1}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="source">Match source slots</SelectItem>
              {props.materialSlots.map(({ id, label }) => (
                <SelectItem key={id} value={id}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
}

function IconAction({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            className="size-6 [&_svg]:size-3"
            aria-label={label}
            disabled={disabled}
            onClick={onClick}
          >
            {children}
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
export function ModifierPanel({ ...props }: ModifierPanelProps) {
  const [, refresh] = useState(0);
  useEffect(
    () => props.scene?.onChange(() => refresh((n) => n + 1)),
    [props.scene],
  );
  return <ModifierEditor key={props.scene?.selection} {...props} />;
}
function ModifierEditor({
  scene,
  saves,
  disabled,
  onBusyChange,
}: ModifierPanelProps) {
  const id = scene?.selection;
  const root = id ? scene?.getObject(id) : undefined;
  const parts = useMemo(() => partsOf(root), [root]);
  const [partIndex, setPartIndex] = useState(0);
  const part = parts[partIndex] ?? parts[0];
  const [draft, setDraft] = useState<MeshModifierSpec[]>([]);
  const [busy, setBusy] = useState(false);
  // Modifiers always act on the whole object, so they are held back while components are picked.
  const componentsPicked = useAppSelector((state) => state.designWorkspace.mode === "edit" && (state.designWorkspace.componentSelection?.ids.length ?? 0) > 0);
  const [error, setError] = useState("");
  const mesh = part?.mesh;
  const [sourceMesh, setSourceMesh] = useState<Mesh | undefined>(undefined);
  const currentModifiers = mesh ? modifierStack(mesh)?.modifiers : undefined;
  const [sourceModifiers, setSourceModifiers] = useState<
    MeshModifierSpec[] | undefined
  >(undefined);
  if (sourceMesh !== mesh || sourceModifiers !== currentModifiers) {
    setSourceMesh(mesh);
    setSourceModifiers(currentModifiers);
    setDraft(
      mesh
        ? (modifierStack(mesh)?.modifiers ?? []).map((entry) => ({ ...entry }))
        : [],
    );
  }
  if (!id || !part || !scene) return null;
  const operands: OperandChoice[] = [];
  for (const [objectId, object] of scene.entries()) {
    const meshes = partsOf(object).filter((candidate) => candidate.mesh !== part.mesh);
    if (meshes.length === 0) continue;
    operands.push({ objectId, name: object.name || objectId, parts: meshes, root: object });
  }
  const materialSlots = (Array.isArray(part.mesh.material) ? part.mesh.material : [part.mesh.material])
    .map(({ name }, index) => ({ id: String(index), label: name || `Slot ${index + 1}` }));
  const locked = disabled || busy || scene.requiresRecovery;
  const stored = modifierStack(part.mesh)?.modifiers ?? [];
  const dirty = JSON.stringify(stored) !== JSON.stringify(draft);
  function update(index: number, next: MeshModifierSpec) {
    setDraft((entries) =>
      entries.map((entry, at) => (at === index ? next : entry)),
    );
  }
  function move(index: number, direction: number) {
    setDraft((entries) => {
      const copy = [...entries];
      const target = copy[index + direction];
      const entry = copy[index];
      if (target && entry) {
        copy[index] = target;
        copy[index + direction] = entry;
      }
      return copy;
    });
  }
  function apply() {
    if (!scene || !id || !part || locked) return;
    const parsed = modifierListSchema.safeParse(draft);
    if (!parsed.success) {
      setError(
        parsed.error.issues[0]?.message ?? "Check the modifier settings.",
      );
      return;
    }
    setBusy(true);
    onBusyChange(true);
    setError("");
    saves.run(
      async () => {
        try {
          await saveModifiers(scene, id, part.path, parsed.data);
        } finally {
          setBusy(false);
          onBusyChange(false);
        }
      },
      (failure) => setError(errorMessage(failure)),
    );
  }
  function add(entry: MeshModifierSpec) {
    setDraft((entries) => (entries.length >= 8 ? entries : [...entries, entry]));
  }
  function setCutterVisibility(objectId: string, visible: boolean) {
    if (!scene || locked || objectId === id) return;
    setBusy(true);
    onBusyChange(true);
    setError("");
    saves.run(async () => {
      try {
        await saveManualCommands(scene, [{ commandId: `visibility_${crypto.randomUUID()}`, type: "scene.set_visibility", objectId, visible }]);
      } finally {
        setBusy(false);
        onBusyChange(false);
      }
    }, (failure) => setError(errorMessage(failure)));
  }
  const full = locked || draft.length >= 8;
  return (
    <TooltipProvider delayDuration={250}>
      <section
        aria-label="Modifiers"
        className="pointer-events-auto w-full rounded-xl border border-border bg-card/95 p-2 text-xs shadow-xl"
      >
        <header className="mb-1.5 flex items-center gap-1">
          <h2 className="flex-1 text-[13px] font-medium">Modifiers</h2>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" size="icon-sm" variant="secondary" className="size-6" aria-label="Add modifier" disabled={full}>
                <Plus className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44 p-1.5">
              {componentsPicked && (
                <p className="px-2 py-1.5 text-[11px] leading-4 text-muted-foreground">
                  Modifiers apply to the whole object. Clear the selection (Esc) to add one, or use Subdivide in the Edit toolbar.
                </p>
              )}
              <DropdownMenuItem
                disabled={full || componentsPicked}
                onSelect={() => add({ id: `bevel_${crypto.randomUUID()}`, kind: "bevel", enabled: true, width: 0.1, segments: 3, profile: "circular", angle: 30 })}
              >
                Bevel
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={full || componentsPicked || operands.length === 0}
                onSelect={() => {
                  const operand = operands[0];
                  if (!operand) return;
                  add({ id: `boolean_${crypto.randomUUID()}`, kind: "boolean", enabled: true, operation: "difference", operandObjectId: operand.objectId, operandMeshPath: operand.parts[0]?.path ?? [] });
                }}
              >
                Boolean
              </DropdownMenuItem>
              {operands.length === 0 && !componentsPicked && (
                <p className="px-2 py-1 text-[11px] leading-4 text-muted-foreground">Add another solid to use as the cutter.</p>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Subdivision</DropdownMenuLabel>
              {SUBDIVISION_METHODS.map((method) => (
                <DropdownMenuItem
                  key={method.value}
                  disabled={full || componentsPicked}
                  onSelect={() => add({ id: `sub_${crypto.randomUUID()}`, kind: "subdivision", enabled: true, levels: 1, method: method.value })}
                >
                  {method.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </header>
        {parts.length > 1 && (
          <Select disabled={locked} value={String(partIndex)} onValueChange={(value) => setPartIndex(Number(value))}>
            <SelectTrigger aria-label="Mesh part" className="mb-1.5 h-6 bg-secondary text-[11px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {parts.map((entry, index) => (
                <SelectItem key={entry.path.join("/")} value={String(index)}>
                  {entry.mesh.name || `Mesh ${index + 1}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {draft.length === 0 && <p className="py-1 text-[11px] text-muted-foreground">No modifiers on this mesh.</p>}
        <div className="space-y-1">
          {draft.map((entry, index) => (
            <div key={entry.id} className={cn("rounded-md border border-border/70 bg-muted/40 px-1.5 py-1", !entry.enabled && "opacity-60")}>
              <div className="flex items-center gap-0.5">
                <span className="min-w-0 flex-1 truncate text-[11px] font-medium">
                  {modifierName(entry.kind)}
                </span>
                <IconAction label={entry.enabled ? "Disable modifier" : "Enable modifier"} disabled={locked} onClick={() => update(index, { ...entry, enabled: !entry.enabled })}>
                  {entry.enabled ? <Eye /> : <EyeOff />}
                </IconAction>
                <IconAction label="Move modifier up" disabled={locked || index === 0 || draft[index - 1]?.kind === "extrusion"} onClick={() => move(index, -1)}><ArrowUp /></IconAction>
                <IconAction label="Move modifier down" disabled={locked || index === draft.length - 1 || entry.kind === "extrusion"} onClick={() => move(index, 1)}><ArrowDown /></IconAction>
                <IconAction label="Remove modifier" disabled={locked} onClick={() => setDraft(draft.filter((_, at) => at !== index))}><Trash2 /></IconAction>
              </div>
              {entry.kind === "bevel" ? (
                <div className="mt-1 space-y-1">
                  <div className="grid grid-cols-2 gap-1">
                    <Select
                      disabled={locked}
                      value={entry.profile ?? "round"}
                      onValueChange={(value) => {
                        if (!isBevelProfile(value) || value === (entry.profile ?? "round")) return;
                        update(index, { ...entry, profile: value });
                      }}
                    >
                      <SelectTrigger aria-label={`Bevel ${index + 1} profile`} className="h-6 px-1.5 text-[11px]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {BEVEL_PROFILES.map((profile) => <SelectItem key={profile.value} value={profile.value}>{profile.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Select
                      disabled={locked}
                      value={String(entry.angle ?? 0)}
                      onValueChange={(value) => {
                        const angle = Number(value);
                        if (!Number.isFinite(angle) || angle === (entry.angle ?? 0)) return;
                        update(index, { ...entry, angle });
                      }}
                    >
                      <SelectTrigger aria-label={`Bevel ${index + 1} angle`} className="h-6 px-1.5 text-[11px]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {angleChoices(entry.angle ?? 0).map((choice) => <SelectItem key={choice.value} value={choice.value}>{choice.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex gap-1">
                    <ScrubNumberInput caption="Width" className="min-w-0 flex-1" id={`${entry.id}-width`} label={`Bevel ${index + 1} width`} min={0.001} max={100} step={0.01} value={entry.width} disabled={locked} onChange={(value) => update(index, { ...entry, width: value })} />
                    <ScrubNumberInput caption="Segments" className="min-w-0 flex-1" id={`${entry.id}-segments`} label={`Bevel ${index + 1} segments`} min={1} max={8} step={1} value={entry.segments} disabled={locked} onChange={(value) => update(index, { ...entry, segments: value })} />
                  </div>
                </div>
              ) : entry.kind === "boolean" ? (
                <BooleanFields entry={entry} index={index} locked={locked} operands={operands} materialSlots={materialSlots}
                  visibilityLocked={dirty}
                  cutterVisible={entry.operandObjectId === id ? undefined : scene.getObject(entry.operandObjectId)?.visible}
                  onCutterVisibility={(visible) => setCutterVisibility(entry.operandObjectId, visible)}
                  onChange={(next) => update(index, next)} />
              ) : entry.kind === "extrusion" ? (
                <div className="mt-1 space-y-1">
                  {entry.normalDistance !== undefined && <ScrubNumberInput caption="Distance" id={`${entry.id}-distance`} label="Extrusion distance" min={-100} max={100} step={0.01} value={entry.normalDistance} disabled={locked} onChange={(value) => update(index, { ...entry, normalDistance: value })} />}
                  {entry.offset && ["X", "Y", "Z"].map((label, axis) => (
                    <ScrubNumberInput key={label} caption={label} id={`${entry.id}-offset-${label}`} label={`Extrusion offset ${label}`} min={-10000} max={10000} step={0.01} value={entry.offset?.[axis] ?? 0} disabled={locked} onChange={(next) => update(index, { ...entry, offset: entry.offset?.map((old, at) => at === axis ? next : old) })} />
                  ))}
                  {(entry.componentKind ?? "face") === "face" && (
                    <>
                      {entry.capScaleXY ? ["X", "Y"].map((label, axis) => (
                        <ScrubNumberInput key={label} caption={`Scale ${label}`} id={`${entry.id}-scale-${label}`} label={`Extrusion cap scale ${label}`} min={0.01} max={100} step={0.01} value={entry.capScaleXY?.[axis] ?? 1} disabled={locked} onChange={(next) => update(index, { ...entry, capScaleXY: entry.capScaleXY?.map((old, at) => at === axis ? next : old) })} />
                      )) : <ScrubNumberInput caption="Scale" id={`${entry.id}-scale`} label="Extrusion cap scale" min={0.01} max={100} step={0.01} value={entry.capScale ?? 1} disabled={locked} onChange={(value) => update(index, { ...entry, capScale: value })} />}
                      <ScrubNumberInput caption="Twist" id={`${entry.id}-twist`} label="Extrusion twist in degrees" min={-180} max={180} step={1} value={entry.twistDegrees ?? 0} disabled={locked} onChange={(value) => update(index, { ...entry, twistDegrees: value })} />
                      {entry.capRotationDegrees && ["X", "Y", "Z"].map((label, axis) => (
                        <ScrubNumberInput key={label} caption={`Rotate ${label}`} id={`${entry.id}-rotate-${label}`} label={`Extrusion cap rotation ${label}`} min={-180} max={180} step={1} value={entry.capRotationDegrees?.[axis] ?? 0} disabled={locked} onChange={(next) => update(index, { ...entry, capRotationDegrees: entry.capRotationDegrees?.map((old, at) => at === axis ? next : old) })} />
                      ))}
                    </>
                  )}
                </div>
              ) : (
                <div className="mt-1 flex items-center gap-1">
                  <Select
                    disabled={locked}
                    value={entry.method ?? "catmull-clark"}
                    onValueChange={(value) => {
                      if (!isSubdivisionMethod(value) || value === (entry.method ?? "catmull-clark")) return;
                      update(index, { ...entry, method: value });
                    }}
                  >
                    <SelectTrigger aria-label={`Subdivision ${index + 1} method`} className="h-6 min-w-0 flex-1 px-1.5 text-[11px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {SUBDIVISION_METHODS.map((method) => <SelectItem key={method.value} value={method.value}>{method.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <ScrubNumberInput caption="Levels" className="w-[5.5rem] shrink-0" id={`${entry.id}-levels`} label={`Subdivision ${index + 1} levels`} min={1} max={3} step={1} value={entry.levels} disabled={locked} onChange={(value) => update(index, { ...entry, levels: value })} />
                </div>
              )}
            </div>
          ))}
        </div>
        {error && <p role="alert" className="mt-1.5 text-[11px] leading-4">{error}</p>}
        <footer className="mt-1.5 flex items-center gap-1">
          <span className="flex-1 text-[10px] text-muted-foreground">{busy ? "Saving…" : dirty ? "Unapplied changes" : "Saved"}</span>
          <IconAction label="Reset unapplied changes" disabled={locked || !dirty} onClick={() => setDraft(stored.map((entry) => ({ ...entry })))}><RotateCcw /></IconAction>
          <Button type="button" size="sm" variant="secondary" className="h-6 gap-1 px-2 text-[11px]" aria-label="Apply and save modifiers" disabled={locked || !dirty} onClick={apply}><Check className="size-3" /> Apply</Button>
        </footer>
      </section>
    </TooltipProvider>
  );
}
