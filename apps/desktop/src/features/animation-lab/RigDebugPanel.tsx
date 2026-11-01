import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import type { FootTelemetry, Telemetry } from "./telemetry";

const DEG = 180 / Math.PI;

function Row({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-[11px]">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono tabular-nums" {...(testId ? { "data-testid": testId } : {})}>
        {value}
      </span>
    </div>
  );
}

function FootBadge({ side, foot }: { side: string; foot: FootTelemetry }) {
  return (
    <div
      className={cn("flex flex-1 items-center justify-between rounded-md border px-2 py-1 text-[11px]", foot.contact ? "border-brand bg-brand/10" : "border-border")}
      data-testid={`foot-${side.toLowerCase()}`}
      data-contact={foot.contact}
    >
      <span className="font-medium">{side}</span>
      <span className="text-muted-foreground">{foot.contact ? "planted" : "swing"}</span>
      <span className="font-mono tabular-nums">{Math.round(foot.progress * 100)}%</span>
    </div>
  );
}

export interface RigDebugPanelProps {
  telemetry: Telemetry | null;
}

/** Live readout of the animation state, motion, contacts and the recent state transitions. */
export function RigDebugPanel({ telemetry }: RigDebugPanelProps) {
  if (!telemetry) return <div className="p-3 text-xs text-muted-foreground">Starting the simulation…</div>;
  const t = telemetry;
  return (
    <div className="grid gap-3 p-3" data-testid="debug-panel">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-muted-foreground">Animation state</span>
        <Badge variant="accent" data-testid="state-badge">
          {t.state.replace("_", " ")}
        </Badge>
      </div>
      <Row label="Previous state" value={`${t.previousState.replace("_", " ")} · ${t.timeInState.toFixed(2)} s ago`} />
      <Separator />
      <Row label="FPS" value={t.fps.toFixed(0)} testId="fps" />
      <Row label="Actual speed" value={`${t.speed.toFixed(2)} m/s`} testId="speed-actual" />
      <Row label="Desired speed" value={`${t.desiredSpeed.toFixed(2)} m/s`} testId="speed-desired" />
      <Row label="Facing" value={`${(t.yaw * DEG).toFixed(0)}°`} />
      <Row label="Heading command" value={`${(t.heading * DEG).toFixed(0)}°`} />
      <Row label="Grounded" value={t.grounded ? "yes" : `no · vy ${t.verticalVelocity.toFixed(2)}`} testId="grounded" />
      <Row label="Jump phase" value={t.jumpPhase} />
      <Separator />
      <div className="flex gap-1.5">
        <FootBadge side="L" foot={t.feet.l} />
        <FootBadge side="R" foot={t.feet.r} />
      </div>
      <Row label="Gait" value={t.gaitMode === "moving" ? `cycle ${t.gaitPhase.toFixed(2)}` : "standing"} />
      <Row label="Stride length" value={`${t.strideLength.toFixed(2)} m`} />
      <Row label="Cadence" value={`${t.cadence.toFixed(2)} steps/s`} />
      <Row label="Contact fraction" value={`${(t.duty * 100).toFixed(0)}% ${t.duty < 0.5 ? "(flight)" : ""}`} />
      <Row label="Forward lean" value={`${(t.lean * DEG).toFixed(1)}°`} />
      <Row label="Pelvis height" value={`${t.pelvisHeight.toFixed(3)} m`} />
      <Row label="Joint limit corrections" value={String(t.limitCorrections)} />
      <Row label="Position" value={`${t.position.x.toFixed(1)}, ${t.position.y.toFixed(2)}, ${t.position.z.toFixed(1)}`} />
      <Separator />
      <div className="grid gap-1" data-testid="transition-log">
        <span className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">State transitions</span>
        {t.transitions.length === 0 && <span className="text-[11px] text-muted-foreground">None yet.</span>}
        {[...t.transitions]
          .reverse()
          .slice(0, 8)
          .map((transition) => (
            <div key={`${transition.time}-${transition.to}`} className="grid gap-0.5 rounded-md bg-muted px-2 py-1 text-[11px]">
              <span className="font-medium">
                {transition.from.replace("_", " ")} → {transition.to.replace("_", " ")}
              </span>
              <span className="text-muted-foreground">
                {transition.time.toFixed(2)} s · {transition.reason}
              </span>
            </div>
          ))}
      </div>
    </div>
  );
}
