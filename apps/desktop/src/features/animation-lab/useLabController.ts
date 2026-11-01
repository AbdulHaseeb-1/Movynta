import { useEffect, useState, type RefObject } from "react";
import { useStore } from "react-redux";
import { useAppSelector } from "@/app/hooks";
import type { RootState } from "@/app/store";
import { LabController } from "./LabController";
import type { Telemetry } from "./telemetry";

export interface LabControllerState {
  controller: LabController | null;
  /** Set when the WebGL renderer or the physics module could not start. */
  error: string | null;
}

/**
 * Creates the lab controller inside `containerRef` and destroys it on unmount. Creation is asynchronous (the
 * physics engine is WebAssembly), so a cancelled flag guarantees a controller that finishes after unmount is
 * disposed immediately and never leaks a second render loop under React StrictMode.
 */
export function useLabController(containerRef: RefObject<HTMLDivElement | null>): LabControllerState {
  const [state, setState] = useState<LabControllerState>({ controller: null, error: null });
  const settings = useAppSelector((root) => root.animationLab);
  const store = useStore<RootState>();

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    let cancelled = false;
    let created: LabController | null = null;

    LabController.create(container, store.getState().animationLab)
      .then((controller) => {
        if (cancelled) {
          controller.dispose();
          return;
        }
        created = controller;
        controller.start();
        exposeForCapture(controller);
        setState({ controller, error: null });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ controller: null, error: error instanceof Error ? error.message : "The 3D view could not start." });
      });

    return () => {
      cancelled = true;
      created?.dispose();
      created = null;
      removeCaptureHandle();
      setState({ controller: null, error: null });
    };
  }, [containerRef, store]);

  // Settings changes flow into the running simulation without recreating anything.
  useEffect(() => {
    state.controller?.apply(settings);
  }, [state.controller, settings]);

  return state;
}

/** Samples the simulation about ten times a second for the debug panels. */
export function useTelemetry(controller: LabController | null, intervalMs = 100): Telemetry | null {
  const [telemetry, setTelemetry] = useState<Telemetry | null>(null);
  useEffect(() => {
    if (!controller) return undefined;
    const sample = () => setTelemetry(controller.telemetry());
    sample();
    const timer = window.setInterval(sample, intervalMs);
    return () => window.clearInterval(timer);
  }, [controller, intervalMs]);
  return telemetry;
}

const CAPTURE_KEY = "movyntaLab";

/**
 * With `?capture` in the address, the controller is reachable from the page so a recording tool can advance time
 * in exact 1/60 s steps and photograph each frame. Normal use never exposes anything.
 */
function exposeForCapture(controller: LabController): void {
  if (!new URLSearchParams(window.location.search).has("capture") && !window.location.hash.includes("capture")) return;
  Reflect.set(window, CAPTURE_KEY, controller);
}

function removeCaptureHandle(): void {
  Reflect.deleteProperty(window, CAPTURE_KEY);
}
