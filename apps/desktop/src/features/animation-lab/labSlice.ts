import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { AnimationTuning } from "@/engine/animation/types";
import { DEFAULT_TUNING } from "@/engine/animation/types";
import type { TerrainPreset } from "@/engine/physics/Terrain";
import {
  BEND_BACKWARD_DEGREES,
  BEND_FORWARD_DEGREES,
  DEFAULT_SETTINGS,
  MAX_COMMAND_SPEED,
  PRESET_SPEEDS,
  type CameraProjection,
  type CameraView,
  type DebugToggles,
  type LabSettings,
  type LocomotionPreset,
} from "./labSettings";

const labSlice = createSlice({
  name: "animationLab",
  initialState: DEFAULT_SETTINGS,
  reducers: {
    /** Locomotion buttons set the speed and remember which one is active. */
    applyPreset(state, action: PayloadAction<LocomotionPreset>) {
      state.activePreset = action.payload;
      state.speed = PRESET_SPEEDS[action.payload];
    },
    setSpeed(state, action: PayloadAction<number>) {
      state.speed = Math.min(Math.max(action.payload, 0), MAX_COMMAND_SPEED);
    },
    setTuning<K extends keyof AnimationTuning>(state: LabSettings, action: PayloadAction<{ key: K; value: AnimationTuning[K] }>) {
      state.tuning[action.payload.key] = action.payload.value;
    },
    bendForward(state) {
      state.tuning.spineBend = state.tuning.spineBend === BEND_FORWARD_DEGREES ? 0 : BEND_FORWARD_DEGREES;
    },
    bendBackward(state) {
      state.tuning.spineBend = state.tuning.spineBend === BEND_BACKWARD_DEGREES ? 0 : BEND_BACKWARD_DEGREES;
    },
    /** Restores the default pose and tuning but keeps the camera, terrain and debug choices. */
    resetPose(state) {
      state.tuning = { ...DEFAULT_TUNING };
      state.speed = 0;
      state.activePreset = "idle";
      state.lockedFacing = false;
      state.strafeDirection = 0;
    },
    setInPlace(state, action: PayloadAction<boolean>) {
      state.inPlace = action.payload;
    },
    setLockedFacing(state, action: PayloadAction<boolean>) {
      state.lockedFacing = action.payload;
    },
    setStrafeDirection(state, action: PayloadAction<number>) {
      state.strafeDirection = action.payload;
    },
    setTerrain(state, action: PayloadAction<TerrainPreset>) {
      state.terrain = action.payload;
    },
    setProjection(state, action: PayloadAction<CameraProjection>) {
      state.projection = action.payload;
    },
    setView(state, action: PayloadAction<CameraView>) {
      state.view = action.payload;
    },
    setFollowCamera(state, action: PayloadAction<boolean>) {
      state.followCamera = action.payload;
    },
    setPaused(state, action: PayloadAction<boolean>) {
      state.paused = action.payload;
    },
    setDebug(state, action: PayloadAction<{ key: keyof DebugToggles; value: boolean }>) {
      state.debug[action.payload.key] = action.payload.value;
    },
  },
});

export const {
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
} = labSlice.actions;
export const labReducer = labSlice.reducer;
