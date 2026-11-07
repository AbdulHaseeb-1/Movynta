import type { ShadingMode } from "./shading";

/** How the viewport draws the scene. The user's last choice is kept across restarts. */
export interface ViewportDisplay {
  shadingMode: ShadingMode;
  /** See through surfaces in Solid and Wireframe; Material shading always draws them opaque. */
  xray: boolean;
  showGrid: boolean;
  /** The shading that Shift+Z returns to when it leaves Wireframe. */
  lastShadedMode: Exclude<ShadingMode, "wireframe">;
}

const KEY = "movynta.viewport.display.v1";
const SHADING_MODES: readonly ShadingMode[] = ["default", "solid", "wireframe"];

export const DEFAULT_VIEWPORT_DISPLAY: ViewportDisplay = {
  shadingMode: "default",
  xray: false,
  showGrid: true,
  lastShadedMode: "default",
};

function shadingModeOf(value: unknown): ShadingMode | undefined {
  return SHADING_MODES.find((mode) => mode === value);
}

/** Reads the saved display settings. Storage that is unavailable, missing or damaged gives the defaults. */
export function loadViewportDisplay(): ViewportDisplay {
  const display = { ...DEFAULT_VIEWPORT_DISPLAY };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return display;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return display;
    const saved = new Map<string, unknown>(Object.entries(parsed));
    display.shadingMode = shadingModeOf(saved.get("shadingMode")) ?? display.shadingMode;
    const lastShaded = shadingModeOf(saved.get("lastShadedMode"));
    if (lastShaded && lastShaded !== "wireframe") display.lastShadedMode = lastShaded;
    const xray = saved.get("xray");
    if (typeof xray === "boolean") display.xray = xray;
    const showGrid = saved.get("showGrid");
    if (typeof showGrid === "boolean") display.showGrid = showGrid;
  } catch {
    /* Storage can be unavailable; use defaults. */
  }
  return display;
}

export function saveViewportDisplay(display: ViewportDisplay): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(display));
  } catch {
    /* Storage is optional. */
  }
}
