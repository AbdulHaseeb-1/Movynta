import type { Telemetry } from "./telemetry";

export interface LabViewportProps {
  containerRef: React.RefObject<HTMLDivElement | null>;
  telemetry: Telemetry | null;
  error: string | null;
}

/** The 3D canvas host with a small always-on readout in the corner. */
export function LabViewport({ containerRef, telemetry, error }: LabViewportProps) {
  return (
    <div className="relative h-full w-full overflow-hidden bg-background [&>canvas]:block" data-testid="lab-viewport">
      <div ref={containerRef} className="absolute inset-0" />
      {telemetry && (
        <div
          className="pointer-events-none absolute top-3 left-3 grid gap-0.5 rounded-md bg-card/80 px-2.5 py-2 font-mono text-[11px] backdrop-blur-sm"
          data-testid="hud"
        >
          <span className="font-sans text-xs font-semibold tracking-wide uppercase" data-testid="hud-state">
            {telemetry.state.replace("_", " ")}
          </span>
          <span>
            {telemetry.speed.toFixed(2)} m/s · {telemetry.fps.toFixed(0)} fps
          </span>
          <span className="text-muted-foreground">{telemetry.grounded ? "grounded" : "airborne"}</span>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-muted-foreground" role="alert" data-testid="lab-error">
          The 3D view could not start: {error}
        </div>
      )}
    </div>
  );
}
