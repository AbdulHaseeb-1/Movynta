import { ChevronDown, ChevronUp, House, PanelLeft, PanelRight } from "lucide-react";
import { useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  LabControls,
  LabViewport,
  RigDebugPanel,
  TimelinePanel,
  useLabController,
  useTelemetry,
} from "@/features/animation-lab";

const WIDE_WINDOW = 1100;

/** Workspace for testing and tuning the 3D stickman animation engine. */
export default function AnimationLab() {
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const { controller, error } = useLabController(containerRef);
  const telemetry = useTelemetry(controller);
  const wide = window.innerWidth >= WIDE_WINDOW;
  const [controlsOpen, setControlsOpen] = useState(wide);
  const [debugOpen, setDebugOpen] = useState(wide);
  const [timelineOpen, setTimelineOpen] = useState(wide);

  return (
    <main className="flex h-full min-h-0 flex-col bg-background font-sans text-foreground" data-testid="animation-lab">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
        <Button size="icon-sm" variant="ghost" aria-label="Home" onClick={() => void navigate("/")}>
          <House className="size-4" />
        </Button>
        <h1 className="text-sm font-semibold">Animation Lab</h1>
        <span className="text-xs text-muted-foreground">3D stickman locomotion engine</span>
        <div className="ml-auto flex items-center gap-1">
          <Button size="sm" variant={controlsOpen ? "secondary" : "ghost"} aria-pressed={controlsOpen} data-testid="toggle-controls" onClick={() => setControlsOpen((v) => !v)}>
            <PanelLeft className="size-3.5" />
            Controls
          </Button>
          <Button size="sm" variant={timelineOpen ? "secondary" : "ghost"} aria-pressed={timelineOpen} data-testid="toggle-timeline" onClick={() => setTimelineOpen((v) => !v)}>
            {timelineOpen ? <ChevronDown className="size-3.5" /> : <ChevronUp className="size-3.5" />}
            Timeline
          </Button>
          <Button size="sm" variant={debugOpen ? "secondary" : "ghost"} aria-pressed={debugOpen} data-testid="toggle-debug" onClick={() => setDebugOpen((v) => !v)}>
            <PanelRight className="size-3.5" />
            Debug
          </Button>
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        {controlsOpen && (
          <aside className="w-[300px] shrink-0 border-r" aria-label="Controls">
            <ScrollArea className="h-full">
              <LabControls controller={controller} />
            </ScrollArea>
          </aside>
        )}
        <section className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1">
            <LabViewport containerRef={containerRef} telemetry={telemetry} error={error} />
          </div>
          {timelineOpen && (
            <div className="max-h-[46%] shrink-0 overflow-y-auto border-t bg-card">
              <TimelinePanel controller={controller} telemetry={telemetry} />
            </div>
          )}
        </section>
        {debugOpen && (
          <aside className="w-[260px] shrink-0 border-l bg-card" aria-label="Debug">
            <ScrollArea className="h-full">
              <RigDebugPanel telemetry={telemetry} />
            </ScrollArea>
          </aside>
        )}
      </div>
    </main>
  );
}
