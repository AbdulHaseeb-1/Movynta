import type { EditorContext } from "@movynta/editor-protocol";
import { Badge } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { AssistantToolVisual } from "../assistantTools/assistantTools.schema";
import { formatNumber, formatVector } from "./format";

type Severity = "error" | "warning" | "info";
type Tone = "solid" | "ghost" | "new";

interface ToolVisualProps {
  readonly visual: AssistantToolVisual;
  readonly scene: EditorContext;
}

/** Draws the picture for one tool from its example data. Colours come from the theme tokens only. */
export function ToolVisual({ visual, scene }: ToolVisualProps) {
  return (
    <figure className="flex h-full min-w-0 flex-col gap-3">
      <div className="min-w-0">{renderVisual(visual, scene)}</div>
      {visual.caption && <figcaption className="text-xs leading-5 text-muted-foreground">{visual.caption}</figcaption>}
    </figure>
  );
}

function renderVisual(visual: AssistantToolVisual, scene: EditorContext) {
  switch (visual.kind) {
    case "tree":
      return <SceneTree scene={scene} />;
    case "counts":
      return <Counts counts={visual.counts} selected={visual.selected} />;
    case "mesh":
      return <MeshFaces vertices={visual.vertices} faces={visual.faces} highlight={visual.highlight} />;
    case "swatch":
      return <Swatch name={visual.name} color={visual.color} meta={visual.meta} meters={visual.meters} textures={visual.textures} />;
    case "frames":
      return <Frames views={visual.views} />;
    case "issues":
      return <Issues ok={visual.ok} objectCount={visual.objectCount} issues={visual.issues} scene={scene} />;
    case "top-view":
      return <TopView boxes={visual.boxes} gap={visual.gap} />;
    case "side-view":
      return <SideView ground={visual.ground} boxes={visual.boxes} guide={visual.guide} />;
    case "steps":
      return <Steps goal={visual.goal} dimension={visual.dimension} steps={visual.steps} />;
    case "batch":
      return <Batch rows={visual.rows} stages={visual.stages} />;
    case "lists":
      return <Lists groups={visual.groups} />;
    default:
      return null;
  }
}

function SceneTree({ scene }: { readonly scene: EditorContext }) {
  const byId = new Map(scene.objects.map((object) => [object.id, object] as const));
  const depthOf = (parentId: string | null): number => {
    let depth = 0;
    let current = parentId;
    while (current !== null && depth < 50) {
      depth += 1;
      current = byId.get(current)?.parentId ?? null;
    }
    return depth;
  };
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
      {scene.objects.map((object) => {
        const selected = scene.selectedObjectIds.includes(object.id);
        const bounds = object.worldBounds ? `${formatVector(object.worldBounds.min)} → ${formatVector(object.worldBounds.max)}` : "no geometry";
        return (
          <li key={object.id} className="flex flex-wrap items-center gap-2 py-2 pr-3 text-sm" style={{ paddingLeft: 12 + depthOf(object.parentId) * 20 }}>
            <Badge variant="outline">{object.type}</Badge>
            <span className="font-medium">{object.name}</span>
            <code className="text-xs text-muted-foreground">{object.id}</code>
            {selected && <Badge variant="accent">selected</Badge>}
            <span className="ml-auto font-mono text-[11px] text-muted-foreground">{bounds}</span>
          </li>
        );
      })}
    </ul>
  );
}

function Counts({ counts, selected }: { readonly counts: readonly { label: string; value: number }[]; readonly selected: readonly string[] }) {
  const total = counts.reduce((sum, count) => sum + count.value, 0);
  const max = Math.max(1, ...counts.map((count) => count.value));
  return (
    <div className="space-y-4">
      <p className="text-2xl font-semibold">{total} objects</p>
      <div className="space-y-2.5">
        {counts.map((count) => (
          <div key={count.label} className="grid grid-cols-[72px_1fr_32px] items-center gap-3 text-sm">
            <span className="text-muted-foreground">{count.label}</span>
            <div className="h-2.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-brand" style={{ width: `${(count.value / max) * 100}%` }} />
            </div>
            <span className="text-right font-semibold">{count.value}</span>
          </div>
        ))}
      </div>
      {selected.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Selected: {selected.map((id) => <code key={id} className="ml-1 rounded bg-muted px-1 py-0.5 text-foreground">{id}</code>)}
        </p>
      )}
    </div>
  );
}

function MeshFaces({ vertices, faces, highlight }: { readonly vertices: readonly (readonly number[])[]; readonly faces: readonly (readonly number[])[]; readonly highlight: readonly number[] }) {
  const scale = 62;
  const cos = Math.cos(Math.PI / 6);
  const project = (point: readonly number[]): [number, number] => {
    const [x = 0, y = 0, z = 0] = point;
    return [150 + (x - z) * cos * scale, 150 + (x + z) * 0.5 * scale - y * scale];
  };
  // Painter's order: faces nearer the viewer (larger x + y + z) are drawn last.
  const depth = (face: readonly number[]) => face.reduce((sum, index) => sum + (vertices[index] ?? []).reduce((a, b) => a + b, 0), 0);
  const ordered = faces.map((face, index) => ({ face, index, depth: depth(face) })).sort((a, b) => a.depth - b.depth);
  return (
    <svg viewBox="0 0 300 250" aria-hidden="true" className="mx-auto w-full max-w-sm">
      {ordered.map(({ face, index }) => (
        <polygon
          key={face.join("-")}
          points={face.map((vertex) => project(vertices[vertex] ?? []).map((n) => n.toFixed(1)).join(",")).join(" ")}
          className={cn("stroke-1", highlight.includes(index) ? "fill-brand/85 stroke-foreground" : "fill-brand/15 stroke-muted-foreground")}
        />
      ))}
      {vertices.map((point, index) => {
        const [x, y] = project(point);
        return (
          <text key={point.join(",")} x={x + 6} y={y - 6} className="fill-foreground text-[11px]">
            v{index}
          </text>
        );
      })}
    </svg>
  );
}

function Swatch({ name, color, meta, meters, textures }: {
  readonly name: string;
  readonly color: string;
  readonly meta: string;
  readonly meters: readonly { label: string; value: number }[];
  readonly textures: readonly string[];
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <span className="size-14 shrink-0 rounded-lg border border-border" style={{ backgroundColor: color }} aria-hidden />
        <div className="min-w-0">
          <p className="font-semibold">{name}</p>
          <p className="text-xs text-muted-foreground">{meta}</p>
        </div>
      </div>
      <div className="space-y-2">
        {meters.map((meter) => (
          <div key={meter.label} className="grid grid-cols-[92px_1fr_36px] items-center gap-3 text-xs">
            <span className="text-muted-foreground">{meter.label}</span>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-brand" style={{ width: `${Math.min(1, Math.max(0, meter.value)) * 100}%` }} />
            </div>
            <span className="text-right font-mono">{formatNumber(meter.value)}</span>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Texture channels: {textures.length > 0 ? textures.join(", ") : "none"}
      </p>
    </div>
  );
}

function Frames({ views }: { readonly views: readonly { label: string; projection: string; width: number; height: number; boxes: readonly { name: string; x: number; y: number; width: number; height: number }[] }[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {views.map((view) => (
        <figure key={view.label} className="min-w-0">
          <svg viewBox={`0 0 ${view.width} ${view.height}`} aria-hidden="true" className="w-full rounded-md border border-border bg-card">
            <line x1={0} y1={view.height / 2} x2={view.width} y2={view.height / 2} className="stroke-border" strokeDasharray="8 8" />
            <line x1={view.width / 2} y1={0} x2={view.width / 2} y2={view.height} className="stroke-border" strokeDasharray="8 8" />
            {view.boxes.map((box) => (
            <g key={`${box.name}-${box.x}-${box.y}`}>
              <rect x={box.x} y={box.y} width={box.width} height={box.height} strokeWidth={2} className="fill-brand/15 stroke-brand" />
                <text x={box.x + 10} y={box.name === "Arm" ? box.y + box.height - 10 : box.y + 26} className="fill-foreground text-[22px]">
                  {box.name}
                </text>
              </g>
            ))}
          </svg>
          <figcaption className="mt-1 text-xs text-muted-foreground">
            {view.label} · {view.projection} · {view.width}×{view.height}
          </figcaption>
        </figure>
      ))}
    </div>
  );
}

function severityVariant(severity: Severity): "destructive" | "accent" | "outline" {
  if (severity === "error") return "destructive";
  if (severity === "warning") return "accent";
  return "outline";
}

function Issues({ ok, objectCount, issues, scene }: {
  readonly ok: boolean;
  readonly objectCount: number;
  readonly issues: readonly { severity: Severity; objectId: string | null; message: string }[];
  readonly scene: EditorContext;
}) {
  const flagged = new Map<string, Severity>();
  for (const issue of issues) {
    if (issue.objectId !== null) flagged.set(issue.objectId, issue.severity);
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge variant={ok ? "success" : "destructive"}>{ok ? "ok: no errors" : "not ok"}</Badge>
        <span className="text-muted-foreground">{objectCount} objects checked</span>
      </div>
      <ul className="space-y-2">
        {issues.map((issue) => (
          <li key={`${issue.objectId ?? "scene"}-${issue.message}`} className="flex gap-3 rounded-lg border border-border bg-card p-3 text-sm">
            <Badge variant={severityVariant(issue.severity)} className="h-fit shrink-0">{issue.severity}</Badge>
            <div className="min-w-0">
              <p className="leading-5">{issue.message}</p>
              {issue.objectId && <code className="text-xs text-muted-foreground">{issue.objectId}</code>}
            </div>
          </li>
        ))}
      </ul>
      <div>
        <p className="mb-2 text-xs font-semibold text-muted-foreground">Objects, with the flagged ones marked</p>
        <div className="flex flex-wrap gap-2">
          {scene.objects.map((object) => {
            const severity = flagged.get(object.id);
            return (
              <span key={object.id} className={cn("rounded-md border px-2 py-1 text-xs", severity === "warning" ? "border-brand text-brand" : "border-border")}>
                {object.name} <span className="text-muted-foreground">{object.id}</span>
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const PLOT_WIDTH = 480;
const PLOT_HEIGHT = 220;
const PAD = 24;

function toneClass(tone: Tone): string {
  if (tone === "new") return "fill-brand/20 stroke-brand";
  if (tone === "ghost") return "fill-none stroke-muted-foreground";
  return "fill-muted stroke-muted-foreground";
}

function TopView({ boxes, gap }: {
  readonly boxes: readonly { label: string; x0: number; x1: number; z0: number; z1: number; tone: Tone }[];
  readonly gap?: { readonly x0: number; readonly x1: number; readonly label: string } | undefined;
}) {
  const minX = Math.min(...boxes.map((box) => box.x0)) - 0.6;
  const maxX = Math.max(...boxes.map((box) => box.x1)) + 0.6;
  const minZ = Math.min(...boxes.map((box) => box.z0)) - 0.6;
  const maxZ = Math.max(...boxes.map((box) => box.z1)) + 0.6;
  const scale = Math.min((PLOT_WIDTH - 2 * PAD) / (maxX - minX), (PLOT_HEIGHT - 2 * PAD) / (maxZ - minZ));
  const X = (x: number) => PAD + (x - minX) * scale;
  const Y = (z: number) => PAD + (z - minZ) * scale;
  const gapY = Y(((boxes[0]?.z0 ?? 0) + (boxes[0]?.z1 ?? 0)) / 2);
  return (
    <svg viewBox={`0 0 ${PLOT_WIDTH} ${PLOT_HEIGHT}`} aria-hidden="true" className="w-full">
      {boxes.map((box) => (
        <g key={box.label + box.x0}>
          <rect x={X(box.x0)} y={Y(box.z0)} width={(box.x1 - box.x0) * scale} height={(box.z1 - box.z0) * scale} strokeWidth={2} strokeDasharray={box.tone === "ghost" ? "6 5" : undefined} className={toneClass(box.tone)} />
          <text x={X(box.x0) + 8} y={Y(box.z0) + 18} className="fill-foreground text-[12px]">{box.label}</text>
        </g>
      ))}
      {gap && (
        <g className="stroke-brand fill-brand">
          <line x1={X(gap.x0)} y1={gapY} x2={X(gap.x1)} y2={gapY} strokeWidth={2} />
          <line x1={X(gap.x0)} y1={gapY - 8} x2={X(gap.x0)} y2={gapY + 8} strokeWidth={2} />
          <line x1={X(gap.x1)} y1={gapY - 8} x2={X(gap.x1)} y2={gapY + 8} strokeWidth={2} />
          <text x={(X(gap.x0) + X(gap.x1)) / 2} y={gapY - 12} textAnchor="middle" className="text-[12px] font-semibold">{gap.label}</text>
        </g>
      )}
      <text x={PAD} y={PLOT_HEIGHT - 6} className="fill-muted-foreground text-[11px]">x across · z toward the bottom</text>
    </svg>
  );
}

function SideView({ ground, boxes, guide }: {
  readonly ground: number;
  readonly boxes: readonly { label: string; x0: number; x1: number; y0: number; y1: number; tone: Tone }[];
  readonly guide?: { readonly y: number; readonly label: string } | undefined;
}) {
  const minX = Math.min(...boxes.map((box) => box.x0)) - 0.6;
  const maxX = Math.max(...boxes.map((box) => box.x1)) + 0.6;
  const minY = Math.min(ground, ...boxes.map((box) => box.y0)) - 0.2;
  const maxY = Math.max(...boxes.map((box) => box.y1)) + 0.2;
  const scale = Math.min((PLOT_WIDTH - 2 * PAD) / (maxX - minX), (PLOT_HEIGHT - 2 * PAD) / (maxY - minY));
  const X = (x: number) => PAD + (x - minX) * scale;
  const Y = (y: number) => PLOT_HEIGHT - PAD - (y - minY) * scale;
  return (
    <svg viewBox={`0 0 ${PLOT_WIDTH} ${PLOT_HEIGHT}`} aria-hidden="true" className="w-full">
      <line x1={PAD} y1={Y(ground)} x2={PLOT_WIDTH - PAD} y2={Y(ground)} className="stroke-border" strokeWidth={2} />
      {boxes.map((box) => (
        <g key={box.label}>
          <rect x={X(box.x0)} y={Y(box.y1)} width={(box.x1 - box.x0) * scale} height={(box.y1 - box.y0) * scale} strokeWidth={2} strokeDasharray={box.tone === "ghost" ? "6 5" : undefined} className={toneClass(box.tone)} />
          <text x={X(box.x0) + 6} y={Y(box.y1) - 8} className="fill-foreground text-[12px]">{box.label}</text>
        </g>
      ))}
      {guide && (
        <g>
          <line x1={PAD} y1={Y(guide.y)} x2={PLOT_WIDTH - PAD} y2={Y(guide.y)} strokeWidth={1.5} strokeDasharray="6 4" className="stroke-brand" />
          <text x={PAD} y={Y(guide.y) + 14} className="fill-brand text-[12px] font-semibold">{guide.label}</text>
        </g>
      )}
      <text x={PAD} y={PLOT_HEIGHT - 6} className="fill-muted-foreground text-[11px]">x across · y up</text>
    </svg>
  );
}

function Steps({ goal, dimension, steps }: {
  readonly goal: string;
  readonly dimension: string;
  readonly steps: readonly { title: string; tool: string; description: string }[];
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-semibold">{goal}</p>
        <Badge variant="outline">{dimension}</Badge>
      </div>
      <ol className="space-y-3">
        {steps.map((step, index) => (
          <li key={step.title} className="grid grid-cols-[28px_1fr] gap-3">
            <span className="grid size-7 place-items-center rounded-full bg-brand/15 text-xs font-semibold text-brand">{index + 1}</span>
            <div className="min-w-0">
              <p className="text-sm font-medium">
                {step.title} <code className="ml-1 rounded bg-muted px-1.5 py-0.5 text-[11px] font-normal text-muted-foreground">{step.tool}</code>
              </p>
              <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{step.description}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Batch({ rows, stages }: {
  readonly rows: readonly { type: string; target: string; detail: string; tone?: "neutral" | "ok" | undefined }[];
  readonly stages: readonly { label: string; detail: string; state: "done" | "current" | "next" }[];
}) {
  return (
    <div className="space-y-4">
      {rows.length > 0 && (
        <ul className="space-y-2">
          {rows.map((row) => (
            <li key={`${row.type}-${row.target}-${row.detail}`} className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant={row.tone === "ok" ? "success" : "outline"}>{row.type}</Badge>
              <code className="text-xs">{row.target}</code>
              {row.detail && <span className="text-muted-foreground">{row.detail}</span>}
            </li>
          ))}
        </ul>
      )}
      <ol className="grid gap-2 sm:grid-cols-2">
        {stages.map((stage) => (
          <li
            key={stage.label}
            className={cn(
              "rounded-lg border p-3 text-xs",
              stage.state === "done" && "border-success/60",
              stage.state === "current" && "border-brand bg-brand/5",
              stage.state === "next" && "border-dashed border-border text-muted-foreground",
            )}
          >
            <p className="text-sm font-semibold">{stage.label}</p>
            <p className="mt-1 leading-5 text-muted-foreground">{stage.detail}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Lists({ groups }: { readonly groups: readonly { title: string; items: readonly string[]; tone: "neutral" | "ok" | "warn" }[] }) {
  return (
    <div className="space-y-5">
      {groups.map((group) => (
        <div key={group.title}>
          <p className={cn("mb-2 text-xs font-semibold uppercase tracking-wide", group.tone === "ok" && "text-success", group.tone === "warn" && "text-brand", group.tone === "neutral" && "text-muted-foreground")}>
            {group.title}
          </p>
          <ul className="space-y-1.5 text-sm">
            {group.items.map((item) => (
              <li key={item} className="flex gap-2">
                <span aria-hidden className="text-muted-foreground">•</span>
                <span className="min-w-0 leading-5">{item}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
