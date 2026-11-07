import { z } from "zod";
import { readStored, writeStored } from "@/lib/storage";
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

export const DEFAULT_VIEWPORT_DISPLAY: ViewportDisplay = {
  shadingMode: "default",
  xray: false,
  showGrid: true,
  lastShadedMode: "default",
};

/** Each field has its own fallback, so one damaged field keeps its default and the others are still restored. */
const displaySchema = z.object({
  shadingMode: z.enum(["default", "solid", "wireframe"]).catch(DEFAULT_VIEWPORT_DISPLAY.shadingMode),
  xray: z.boolean().catch(DEFAULT_VIEWPORT_DISPLAY.xray),
  showGrid: z.boolean().catch(DEFAULT_VIEWPORT_DISPLAY.showGrid),
  lastShadedMode: z.enum(["default", "solid"]).catch(DEFAULT_VIEWPORT_DISPLAY.lastShadedMode),
});

/** Reads the saved display settings. Storage that is unavailable, missing or damaged gives the defaults. */
export function loadViewportDisplay(): ViewportDisplay {
  return { ...DEFAULT_VIEWPORT_DISPLAY, ...readStored(KEY, displaySchema) };
}

/** Remembers the viewport's display options, so they survive a reload. */
export function saveViewportDisplay(display: ViewportDisplay): void {
  writeStored(KEY, display);
}
