import { useEffect, useMemo, useState } from "react";
import type { Mesh, Object3D } from "three";
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
import { isEditableTarget } from "@/features/meshGeometry/meshInspection";
import { errorMessage, type SerialQueue } from "@/lib";
import { saveModifiers } from "./manualModifiers";

interface ModifierPanelProps {
  scene: EditorScene | null;
  saves: SerialQueue;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
}
interface MeshPart {
  mesh: Mesh;
  path: number[];
}
function partsOf(root: Object3D | undefined): MeshPart[] {
  const parts: MeshPart[] = [];
  const visit = (node: Object3D, path: number[]) => {
    if (isEditableTarget(node)) parts.push({ mesh: node, path });
    node.children.forEach((child, index) => visit(child, [...path, index]));
  };
  if (root) visit(root, []);
  return parts;
}
const SUBDIVISION_METHODS = [
  { value: "catmull-clark", label: "Catmull–Clark" },
  { value: "linear", label: "Linear" },
  { value: "loop", label: "Loop" },
] as const;
const BEVEL_PROFILES = [
  { value: "round", label: "Round" },
  { value: "chamfer", label: "Chamfer" },
] as const;
const BEVEL_ANGLES = [
  { value: "0", label: "All edges" },
  { value: "15", label: "Mild 15°" },
  { value: "30", label: "Sharp 30°" },
  { value: "60", label: "Hard 60°" },
] as const;
type SubdivisionMethod = (typeof SUBDIVISION_METHODS)[number]["value"];
type BevelProfile = (typeof BEVEL_PROFILES)[number]["value"];
function isSubdivisionMethod(value: string): value is SubdivisionMethod {
  return SUBDIVISION_METHODS.some((method) => method.value === value);
}
function isBevelProfile(value: string): value is BevelProfile {
  return BEVEL_PROFILES.some((profile) => profile.value === value);
}
function angleChoices(angle: number): { value: string; label: string }[] {
  const value = String(angle);
  if (BEVEL_ANGLES.some((choice) => choice.value === value)) return [...BEVEL_ANGLES];
  return [...BEVEL_ANGLES, { value, label: `${angle}°` }];
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
        "Use a positive width up to 100, 1–8 bevel segments, an angle from 0 to 180, and 1–3 subdivision levels.",
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
              <DropdownMenuItem
                disabled={full}
                onSelect={() => add({ id: `bevel_${crypto.randomUUID()}`, kind: "bevel", enabled: true, width: 0.1, segments: 3, profile: "round", angle: 30 })}
              >
                Bevel
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Subdivision</DropdownMenuLabel>
              {SUBDIVISION_METHODS.map((method) => (
                <DropdownMenuItem
                  key={method.value}
                  disabled={full}
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
                  {entry.kind === "bevel" ? "Bevel" : "Subdivision"}
                </span>
                <IconAction label={entry.enabled ? "Disable modifier" : "Enable modifier"} disabled={locked} onClick={() => update(index, { ...entry, enabled: !entry.enabled })}>
                  {entry.enabled ? <Eye /> : <EyeOff />}
                </IconAction>
                <IconAction label="Move modifier up" disabled={locked || index === 0} onClick={() => move(index, -1)}><ArrowUp /></IconAction>
                <IconAction label="Move modifier down" disabled={locked || index === draft.length - 1} onClick={() => move(index, 1)}><ArrowDown /></IconAction>
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
          <IconAction label="Apply and save modifiers" disabled={locked || !dirty} onClick={apply}><Check /></IconAction>
        </footer>
      </section>
    </TooltipProvider>
  );
}
