import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Footprints,
  Gauge,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  StopCircle,
  Wind,
  Zap,
  ChevronsUp,
  Accessibility,
  PersonStanding,
  type LucideIcon,
} from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import type { AnimationTuning } from "@/engine/animation/types";
import { isTerrainPreset, TERRAIN_PRESETS } from "@/engine/physics/Terrain";
import { cn } from "@/lib/utils";
import type { LabController } from "./LabController";
import {
  applyPreset,
  bendBackward,
  bendForward,
  resetPose,
  setDebug,
  setFollowCamera,
  setInPlace,
  setLockedFacing,
  setPaused,
  setProjection,
  setSpeed,
  setStrafeDirection,
  setTerrain,
  setTuning,
  setView,
} from "./labSlice";
import {
  BEND_BACKWARD_DEGREES,
  BEND_FORWARD_DEGREES,
  MAX_COMMAND_SPEED,
  type CameraProjection,
  type CameraView,
  type DebugToggles,
  type LocomotionPreset,
} from "./labSettings";
import { SliderField } from "./SliderField";

interface PresetButton {
  preset: LocomotionPreset;
  label: string;
  icon: LucideIcon;
}

const PRESET_BUTTONS: readonly PresetButton[] = [
  { preset: "idle", label: "Idle", icon: PersonStanding },
  { preset: "walk", label: "Walk", icon: Footprints },
  { preset: "run", label: "Run", icon: Wind },
  { preset: "fast_run", label: "Fast Run", icon: Gauge },
  { preset: "sprint", label: "Sprint", icon: Zap },
  { preset: "stop", label: "Stop", icon: StopCircle },
];

interface TuningSlider {
  key: keyof AnimationTuning;
  label: string;
  min: number;
  max: number;
  step: number;
  unit?: string;
  decimals?: number;
}

/** The behavior sliders. Each one changes a value the simulation actually reads. */
const TUNING_SLIDERS: readonly TuningSlider[] = [
  { key: "strideLength", label: "Stride length", min: 0.6, max: 1.5, step: 0.01, unit: "×" },
  { key: "stepFrequency", label: "Step frequency", min: 0.7, max: 1.4, step: 0.01, unit: "×" },
  { key: "forwardLean", label: "Body forward lean", min: 0, max: 2, step: 0.01, unit: "×" },
  { key: "spineBend", label: "Spine bend", min: -60, max: 90, step: 1, unit: "°", decimals: 0 },
  { key: "armSwing", label: "Arm swing intensity", min: 0, max: 2, step: 0.01, unit: "×" },
  { key: "kneeLift", label: "Knee lift", min: 0.3, max: 2, step: 0.01, unit: "×" },
  { key: "pelvisBounce", label: "Pelvis bounce", min: 0, max: 2, step: 0.01, unit: "×" },
  { key: "turningSpeed", label: "Turning speed", min: 60, max: 540, step: 5, unit: "°/s", decimals: 0 },
  { key: "blendDuration", label: "Animation blend duration", min: 0.02, max: 1, step: 0.01, unit: " s" },
  { key: "footIK", label: "Foot IK strength", min: 0, max: 1, step: 0.01 },
  { key: "secondaryMotion", label: "Secondary motion", min: 0, max: 2, step: 0.01, unit: "×" },
];

const DEBUG_LABELS: readonly { key: keyof DebugToggles; label: string }[] = [
  { key: "skeleton", label: "Skeleton bones" },
  { key: "ikTargets", label: "IK targets" },
  { key: "contacts", label: "Foot contacts" },
  { key: "trajectory", label: "Root trajectory" },
  { key: "collider", label: "Character collider" },
  { key: "centerOfMass", label: "Center of mass" },
];

const VIEW_BUTTONS: readonly { view: CameraView; label: string }[] = [
  { view: "front", label: "Front" },
  { view: "side", label: "Side" },
  { view: "rear", label: "Rear" },
  { view: "three-quarter", label: "3/4" },
];

function SectionTitle({ children }: { children: string }) {
  return <h3 className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{children}</h3>;
}

function ToggleRow({ label, checked, onChange, id }: { label: string; checked: boolean; onChange: (value: boolean) => void; id: string }) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span id={`label-${id}`}>{label}</span>
      <Switch aria-labelledby={`label-${id}`} data-testid={`switch-${id}`} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

export interface LabControlsProps {
  controller: LabController | null;
}

/** Buttons, live sliders and options. Everything here edits `animationLab` settings or sends a command. */
export function LabControls({ controller }: LabControlsProps) {
  const dispatch = useAppDispatch();
  const settings = useAppSelector((root) => root.animationLab);
  const tuning = settings.tuning;
  const ready = controller !== null;

  return (
    <div className="grid gap-4 p-3 text-xs" data-testid="lab-controls">
      <section className="grid gap-2">
        <SectionTitle>Movement</SectionTitle>
        <div className="grid grid-cols-2 gap-1.5">
          {PRESET_BUTTONS.map(({ preset, label, icon: Icon }) => (
            <Button
              key={preset}
              size="sm"
              variant={settings.activePreset === preset ? "default" : "secondary"}
              disabled={!ready}
              data-testid={`button-${preset}`}
              onClick={() => dispatch(applyPreset(preset))}
            >
              <Icon className="size-3.5" />
              {label}
            </Button>
          ))}
          <Button size="sm" variant="secondary" disabled={!ready} data-testid="button-jump" onClick={() => controller?.jump()}>
            <ChevronsUp className="size-3.5" />
            Jump
          </Button>
          <Button size="sm" variant="secondary" disabled={!ready || settings.lockedFacing} data-testid="button-turn-left" onClick={() => controller?.turn(1)}>
            <RotateCcw className="size-3.5" />
            Turn Left
          </Button>
          <Button size="sm" variant="secondary" disabled={!ready || settings.lockedFacing} data-testid="button-turn-right" onClick={() => controller?.turn(-1)}>
            <RotateCw className="size-3.5" />
            Turn Right
          </Button>
          <Button
            size="sm"
            variant={tuning.spineBend === BEND_FORWARD_DEGREES ? "default" : "secondary"}
            disabled={!ready}
            data-testid="button-bend-forward"
            onClick={() => dispatch(bendForward())}
          >
            <ArrowDownToLine className="size-3.5" />
            Bend Forward
          </Button>
          <Button
            size="sm"
            variant={tuning.spineBend === BEND_BACKWARD_DEGREES ? "default" : "secondary"}
            disabled={!ready}
            data-testid="button-bend-backward"
            onClick={() => dispatch(bendBackward())}
          >
            <ArrowUpFromLine className="size-3.5" />
            Bend Backward
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!ready}
            data-testid="button-reset-pose"
            onClick={() => {
              dispatch(resetPose());
              controller?.reset();
            }}
          >
            <Accessibility className="size-3.5" />
            Reset Pose
          </Button>
        </div>
      </section>

      <Separator />

      <section className="grid gap-3">
        <SectionTitle>Live parameters</SectionTitle>
        <SliderField
          id="speed"
          label="Movement speed"
          value={settings.speed}
          min={0}
          max={MAX_COMMAND_SPEED}
          step={0.05}
          unit=" m/s"
          onChange={(value) => dispatch(setSpeed(value))}
        />
        {TUNING_SLIDERS.map((slider) => (
          <SliderField
            key={slider.key}
            id={slider.key}
            label={slider.label}
            value={tuning[slider.key]}
            min={slider.min}
            max={slider.max}
            step={slider.step}
            {...(slider.unit === undefined ? {} : { unit: slider.unit })}
            {...(slider.decimals === undefined ? {} : { decimals: slider.decimals })}
            onChange={(value) => dispatch(setTuning({ key: slider.key, value }))}
          />
        ))}
      </section>

      <Separator />

      <section className="grid gap-2.5">
        <SectionTitle>Locomotion</SectionTitle>
        <ToggleRow id="in-place" label="In-place (treadmill) mode" checked={settings.inPlace} onChange={(value) => dispatch(setInPlace(value))} />
        <ToggleRow id="locked-facing" label="Lock facing (strafe / backpedal)" checked={settings.lockedFacing} onChange={(value) => dispatch(setLockedFacing(value))} />
        {settings.lockedFacing && (
          <SliderField
            id="strafe-direction"
            label="Travel direction relative to facing"
            value={settings.strafeDirection}
            min={-180}
            max={180}
            step={15}
            unit="°"
            decimals={0}
            onChange={(value) => dispatch(setStrafeDirection(value))}
          />
        )}
        <div className="grid gap-1">
          <span className="text-muted-foreground">Terrain</span>
          <Select value={settings.terrain} onValueChange={(value) => {
              if (isTerrainPreset(value)) dispatch(setTerrain(value));
            }}>
            <SelectTrigger data-testid="select-terrain" aria-label="Terrain">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TERRAIN_PRESETS.map((preset) => (
                <SelectItem key={preset} value={preset}>
                  {preset === "course" ? "Test course (all)" : preset[0]?.toUpperCase() + preset.slice(1)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </section>

      <Separator />

      <section className="grid gap-2.5">
        <SectionTitle>Camera</SectionTitle>
        <div className="grid grid-cols-2 gap-1.5">
          {(["perspective", "orthographic"] as const).map((projection) => (
            <Button
              key={projection}
              size="sm"
              variant={settings.projection === projection ? "default" : "secondary"}
              data-testid={`button-${projection}`}
              onClick={() => dispatch(setProjection(projection satisfies CameraProjection))}
            >
              {projection === "perspective" ? "Perspective" : "Orthographic"}
            </Button>
          ))}
        </div>
        <div className="grid grid-cols-4 gap-1.5">
          {VIEW_BUTTONS.map(({ view, label }) => (
            <Button
              key={view}
              size="sm"
              variant={settings.view === view ? "default" : "secondary"}
              data-testid={`button-view-${view}`}
              onClick={() => dispatch(setView(view))}
            >
              {label}
            </Button>
          ))}
        </div>
        <ToggleRow id="follow" label="Follow character" checked={settings.followCamera} onChange={(value) => dispatch(setFollowCamera(value))} />
      </section>

      <Separator />

      <section className="grid gap-2.5">
        <SectionTitle>Debug overlays</SectionTitle>
        {DEBUG_LABELS.map(({ key, label }) => (
          <ToggleRow key={key} id={`debug-${key}`} label={label} checked={settings.debug[key]} onChange={(value) => dispatch(setDebug({ key, value }))} />
        ))}
      </section>

      <Separator />

      <Button
        size="sm"
        variant="outline"
        disabled={!ready}
        data-testid="button-pause"
        className={cn(settings.paused && "border-brand")}
        onClick={() => dispatch(setPaused(!settings.paused))}
      >
        {settings.paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
        {settings.paused ? "Resume simulation" : "Pause simulation"}
      </Button>
    </div>
  );
}
