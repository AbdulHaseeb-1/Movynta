import { Copy, Hand, Pause, Play, Repeat, Square, StepForward, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { JOINT_LIMITS } from "@/engine/character/JointLimits";
import { BONE_NAMES, type BoneName } from "@/engine/character/types";
import type { LabController } from "./LabController";
import { SliderField } from "./SliderField";
import type { Telemetry } from "./telemetry";

const EDITABLE_BONES = BONE_NAMES.filter((name) => name !== "root");
const PLAYBACK_SPEEDS = [0.25, 0.5, 1, 1.5, 2] as const;
const AXES = ["x", "y", "z"] as const;

function labelOf(bone: BoneName): string {
  return bone.replace(/_/g, " ");
}

function isEditableBone(value: string): value is BoneName {
  return EDITABLE_BONES.some((bone) => bone === value);
}

export interface TimelinePanelProps {
  controller: LabController | null;
  telemetry: Telemetry | null;
}

/**
 * Keyframe timeline: playback controls, a scrubber, and per-joint rotation keys. Editing a joint writes a key at
 * the playhead; the keyed joints then override the procedural animation while the layer is enabled.
 */
export function TimelinePanel({ controller, telemetry }: TimelinePanelProps) {
  const [bone, setBone] = useState<BoneName>("upper_arm_l");
  // Bumped after every command so values read straight from the engine are redrawn immediately.
  const [, setRevision] = useState(0);
  const [clipText, setClipText] = useState("");
  const api = controller?.timeline ?? null;
  const t = telemetry?.timeline ?? null;
  if (!api || !t) return <div className="p-3 text-xs text-muted-foreground">Timeline unavailable.</div>;

  const run = (command: () => void) => {
    command();
    setRevision((value) => value + 1);
  };
  const limits = JOINT_LIMITS[bone];
  const angles = api.angles(bone);
  const keyTimes = api.keyTimes(bone);

  return (
    <div className="grid gap-3 p-3 text-xs" data-testid="timeline-panel">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="icon-sm" variant="secondary" aria-label="Play" data-testid="timeline-play" onClick={() => run(() => api.play())}>
          <Play className="size-3.5" />
        </Button>
        <Button size="icon-sm" variant="secondary" aria-label="Pause" data-testid="timeline-pause" onClick={() => run(() => api.pause())}>
          <Pause className="size-3.5" />
        </Button>
        <Button size="icon-sm" variant="secondary" aria-label="Resume" data-testid="timeline-resume" onClick={() => run(() => api.resume())}>
          <StepForward className="size-3.5" />
        </Button>
        <Button size="icon-sm" variant="secondary" aria-label="Stop" data-testid="timeline-stop" onClick={() => run(() => api.stop())}>
          <Square className="size-3.5" />
        </Button>
        <Button size="icon-sm" variant={t.loop ? "default" : "secondary"} aria-label="Loop" aria-pressed={t.loop} data-testid="timeline-loop" onClick={() => run(() => api.toggleLoop())}>
          <Repeat className="size-3.5" />
        </Button>
        <Button size="sm" variant="secondary" data-testid="timeline-wave" onClick={() => run(() => api.playWave())}>
          <Hand className="size-3.5" />
          Wave pose
        </Button>
        <div className="w-24">
          <Select value={String(t.speed)} onValueChange={(value) => run(() => api.setSpeed(Number(value)))}>
            <SelectTrigger aria-label="Playback speed" data-testid="timeline-speed">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PLAYBACK_SPEEDS.map((speed) => (
                <SelectItem key={speed} value={String(speed)}>
                  {speed}×
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <span className="ml-auto font-mono tabular-nums" data-testid="timeline-time">
          {t.time.toFixed(2)} / {t.duration.toFixed(2)} s · {t.state}
        </span>
      </div>

      <Slider
        aria-label="Scrub"
        data-testid="timeline-scrub"
        min={0}
        max={t.duration}
        step={0.01}
        value={[api.time]}
        onValueChange={(value) => {
          const first = value[0];
          if (first !== undefined) run(() => api.scrub(first));
        }}
      />

      <div className="flex items-center justify-between gap-2">
        <span>Keyframe layer overrides keyed joints</span>
        <Switch aria-label="Keyframe layer" data-testid="switch-timeline-layer" checked={t.active} onCheckedChange={(value) => run(() => api.setLayerActive(value))} />
      </div>

      <div className="grid grid-cols-[9rem_1fr] gap-3">
        <div className="grid content-start gap-1.5">
          <span className="text-muted-foreground">Selected joint</span>
          <Select
            value={bone}
            onValueChange={(value) => {
              if (isEditableBone(value)) setBone(value);
            }}
          >
            <SelectTrigger aria-label="Selected joint" data-testid="timeline-joint">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EDITABLE_BONES.map((name) => (
                <SelectItem key={name} value={name}>
                  {labelOf(name)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex flex-wrap gap-1" data-testid="timeline-keys">
            {keyTimes.length === 0 && <span className="text-muted-foreground">No keys</span>}
            {keyTimes.map((time) => (
              <button key={time} type="button" className="rounded bg-muted px-1.5 py-0.5 font-mono hover:bg-accent" onClick={() => run(() => api.scrub(time))}>
                {time.toFixed(2)}
              </button>
            ))}
          </div>
          <Button size="sm" variant="outline" data-testid="timeline-delete-key" onClick={() => run(() => api.removeKey(bone))}>
            <Trash2 className="size-3.5" />
            Delete key
          </Button>
        </div>
        <div className="grid gap-2">
          {AXES.map((axis) => (
            <SliderField
              key={axis}
              id={`joint-${axis}`}
              label={`${labelOf(bone)} rotation ${axis.toUpperCase()}`}
              value={Math.min(Math.max(angles[axis], limits[axis].min), limits[axis].max)}
              min={limits[axis].min}
              max={limits[axis].max}
              step={1}
              unit="°"
              decimals={0}
              onChange={(value) => run(() => api.setAngles(bone, { ...angles, [axis]: value }))}
            />
          ))}
        </div>
      </div>

      <div className="grid gap-1.5">
        <div className="flex gap-1.5">
          <Button
            size="sm"
            variant="secondary"
            data-testid="timeline-export"
            onClick={() => {
              const json = api.exportJson();
              setClipText(json);
              void navigator.clipboard?.writeText(json).catch(() => undefined);
            }}
          >
            <Copy className="size-3.5" />
            Export clip JSON
          </Button>
          <Button size="sm" variant="secondary" data-testid="timeline-import" onClick={() => run(() => void api.importJson(clipText))}>
            Import
          </Button>
        </div>
        <textarea
          className="h-16 resize-none rounded-md border border-input bg-transparent p-2 font-mono text-[10px]"
          aria-label="Clip JSON"
          data-testid="timeline-json"
          value={clipText}
          onChange={(event) => setClipText(event.target.value)}
          spellCheck={false}
        />
      </div>
    </div>
  );
}
