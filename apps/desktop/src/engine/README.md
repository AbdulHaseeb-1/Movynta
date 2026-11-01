# Stickman animation engine

A procedural 3D stickman locomotion engine (`src/engine/`) and the React test editor that drives it
(`src/features/animation-lab/`, route `#/lab`, reachable from the Home page card). It is a separate module: nothing
in the existing studio/assistant code imports it.

## Layers (each folder has an `index.ts` with its public exports)

| Folder | Responsibility |
| --- | --- |
| `core/` | Math helpers, fixed-step `SimulationClock` (120 Hz, interpolation alpha), `EngineLoop` (the one rAF loop). |
| `character/` | 23-bone rig (`SkeletonBuilder`, `CharacterRig`), `Pose`, `JointLimits`, `CharacterController` (velocity driven root). |
| `ik/` | Analytic two-bone IK with hinge-only knee (`TwoBoneIK`), leg solve (`LegIK`), foot roll/placement (`FootPlacement`). |
| `animation/` | Gait (`GaitController`, `GaitProfiles`), pose generation (`LocomotionGenerator`), `AnimationStateMachine`, `AnimationBlender`, `JumpSequence`, keyframe `AnimationTimeline` and `clips`. |
| `motion/` | `SpineController` (bend spread over 3 joints, head stabilisation), `BodyDynamics` (spring lean/compression), `SecondaryMotion`. |
| `physics/` | Rapier world, kinematic character controller, terrain presets, ground sampling. |
| `testing/` | `MotionDiagnostics`: NaN, teleport, joint snap, limit, penetration, stance drift, heap checks used by the tests. |
| `CharacterSimulation.ts` | Facade composing all of the above; `advance(dt)` runs fixed steps and returns the render alpha. |

## How locomotion works

* One master gait phase per character. Each foot is in stance or swing; touchdown and liftoff are explicit events.
  Duty factor is above 0.5 for walking (double support) and below 0.5 for running (flight phase).
* Stance feet are world-locked and roll heel, flat, ball. Swing feet follow an arc to a landing spot chosen from
  velocity, stride length and a capture-point braking offset.
* The pelvis height comes from the planted feet and is clamped to leg reach, so knees never lock fully straight.
* The root moves from a commanded speed and heading (velocity-driven, with acceleration limits); animation reads
  a smoothed copy of that velocity.
* The state machine (idle, walk, run, fast run, sprint, plus accelerate/decelerate/stop/turn overlays, and the
  jump sequence) uses hysteresis bands, so the speed slider never flickers between states.
* Rapier moves a kinematic capsule: slopes, steps, platforms, walls, jumps and landings. Snap-to-ground is disabled
  and replaced by an explicit settle, because Rapier's built-in snap dropped horizontal movement.

## Keyframe clip format (version 1)

See `animation/AnimationTimeline.ts`. A clip is JSON: `{ version: 1, name, duration, loop, tracks }` where each track
is a list of `{ time, rotation: [x, y, z, w] }` local quaternions per bone. The timeline slerps between keys and
overrides only the keyed bones. Import/export is validated with zod (`parseClip`). The lab's "Wave pose" button
loads `createWaveClip()` from `animation/clips.ts`.

## Tests and reproduction commands

Run from `apps/desktop` (after `pnpm install` at the repo root):

```
pnpm test            # unit + simulation tests (tests A-G, terrain, turning, sliders, frame-rate independence)
pnpm test:soak       # Test H: 5 minutes of simulated locomotion, diagnostics and heap growth
pnpm test:e2e        # Playwright against a real Vite server and Chromium; needs a Chromium build matching playwright
pnpm check           # from the repo root: typecheck and oxlint
pnpm build           # production build
```

The e2e tests render with SwiftShader (software WebGL) in headless Chromium. Frame timings from that setup say
nothing about real GPU performance.

`window.movyntaLab` (only with `?capture` in the URL) exposes `advance(seconds)` and `fastForward(seconds)` so
tools can step the simulation deterministically and capture exact frames; the demo video was recorded this way.

## Known limits

* Tauri packaging and a native Windows build were not validated in the Linux sandbox this was written in.
* Real-GPU frame rate was not measured.
* The 5 minute soak and the frame-rate tests (30/60/120 fps) run in Node without rendering.
