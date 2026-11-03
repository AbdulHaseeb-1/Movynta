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
  Layers3,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
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
        "Use a positive width up to 100, 1–8 bevel segments, and 1–3 subdivision levels.",
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
  return (
    <TooltipProvider delayDuration={250}>
      <section
        aria-label="Modifiers"
        className="pointer-events-auto w-full rounded-xl border border-border bg-card/95 p-3 text-xs shadow-xl"
      >
        <header className="mb-3 flex items-center gap-2">
          <Layers3 className="size-3.5 text-muted-foreground" />
          <h2 className="flex-1 font-medium">Modifiers</h2>
          <span className="text-[10px] text-muted-foreground">Active mesh</span>
        </header>
        {parts.length > 1 && (
          <Select
            disabled={locked}
            value={String(partIndex)}
            onValueChange={(value) => setPartIndex(Number(value))}
          >
            <SelectTrigger
              aria-label="Mesh part"
              className="mb-2 h-7 bg-secondary"
            >
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
        <div className="mb-2 grid grid-cols-2 gap-1">
          <Button
            size="sm"
            variant="secondary"
            disabled={locked || draft.length >= 8}
            className="h-7 gap-1 text-[11px]"
            onClick={() =>
              setDraft([
                ...draft,
                {
                  id: `bevel_${crypto.randomUUID()}`,
                  kind: "bevel",
                  enabled: true,
                  width: 0.1,
                  segments: 4,
                },
              ])
            }
          >
            <Plus className="size-3" />
            Bevel
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={locked || draft.length >= 8}
            className="h-7 gap-1 text-[11px]"
            onClick={() =>
              setDraft([
                ...draft,
                {
                  id: `sub_${crypto.randomUUID()}`,
                  kind: "subdivision",
                  enabled: true,
                  levels: 1,
                },
              ])
            }
          >
            <Plus className="size-3" />
            Subdivision
          </Button>
        </div>
        {draft.length === 0 && (
          <p className="py-2 text-[11px] text-muted-foreground">
            Add a modifier to refine the selected mesh.
          </p>
        )}
        <div className="space-y-2">
          {draft.map((entry, index) => (
            <div key={entry.id} className="rounded-lg bg-muted p-2">
              <div className="mb-2 flex items-center gap-1">
                <span className="flex-1 text-[11px]">
                  {entry.kind === "bevel" ? "Bevel" : "Subdivision"}
                </span>
                <IconAction
                  label={entry.enabled ? "Disable modifier" : "Enable modifier"}
                  disabled={locked}
                  onClick={() =>
                    update(index, { ...entry, enabled: !entry.enabled })
                  }
                >
                  {entry.enabled ? <Eye /> : <EyeOff />}
                </IconAction>
                <IconAction
                  label="Move modifier up"
                  disabled={locked || index === 0}
                  onClick={() => move(index, -1)}
                >
                  <ArrowUp />
                </IconAction>
                <IconAction
                  label="Move modifier down"
                  disabled={locked || index === draft.length - 1}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDown />
                </IconAction>
                <IconAction
                  label="Remove modifier"
                  disabled={locked}
                  onClick={() =>
                    setDraft(draft.filter((_, at) => at !== index))
                  }
                >
                  <Trash2 />
                </IconAction>
              </div>
              <div className="flex gap-2">
                {entry.kind === "bevel" ? (
                  <>
                    <ScrubNumberInput
                      caption="Width"
                      className="flex-1"
                      id={`${entry.id}-width`}
                      label={`Bevel ${index + 1} width`}
                      min={0.001}
                      max={100}
                      step={0.01}
                      value={entry.width}
                      disabled={locked}
                      onChange={(value) =>
                        update(index, {
                          ...entry,
                          width: value,
                        })
                      }
                    />
                    <ScrubNumberInput
                      caption="Segments"
                      className="flex-1"
                      label={`Bevel ${index + 1} segments`}
                      id={`${entry.id}-segments`}
                      min={1}
                      max={8}
                      step={1}
                      value={entry.segments}
                      disabled={locked}
                      onChange={(value) =>
                        update(index, {
                          ...entry,
                          segments: value,
                        })
                      }
                    />
                  </>
                ) : (
                  <ScrubNumberInput
                    caption="Levels"
                    className="w-full"
                    label={`Subdivision ${index + 1} levels`}
                    id={`${entry.id}-levels`}
                    min={1}
                    max={3}
                    step={1}
                    value={entry.levels}
                    disabled={locked}
                    onChange={(value) =>
                      update(index, {
                        ...entry,
                        levels: value,
                      })
                    }
                  />
                )}
              </div>
            </div>
          ))}
        </div>
        {error && (
          <p role="alert" className="mt-2 text-[11px] leading-4">
            {error}
          </p>
        )}
        <footer className="mt-2 flex items-center gap-1">
          <span className="flex-1 text-[10px] text-muted-foreground">
            {busy
              ? "Saving…"
              : dirty
                ? "Unapplied changes"
                : "Live, adjustable geometry"}
          </span>
          <IconAction
            label="Reset unapplied changes"
            disabled={locked || !dirty}
            onClick={() => setDraft(stored.map((entry) => ({ ...entry })))}
          >
            <RotateCcw />
          </IconAction>
          <IconAction
            label="Apply and save modifiers"
            disabled={locked || !dirty}
            onClick={apply}
          >
            <Check />
          </IconAction>
        </footer>
      </section>
    </TooltipProvider>
  );
}
