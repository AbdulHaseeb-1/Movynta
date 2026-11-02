import type { ViewportTool } from "@/features/viewport3d";

/** The handle each transform tool shows, in the names the transform controls use. */
export const HANDLE_MODES = {
  move: "translate",
  rotate: "rotate",
  scale: "scale",
} as const;

export type HandleMode = (typeof HANDLE_MODES)[keyof typeof HANDLE_MODES];

/** Whether a tool shows handles at all: Select and Pan only click and navigate. */
export function isHandleTool(tool: ViewportTool): tool is keyof typeof HANDLE_MODES {
  return tool in HANDLE_MODES;
}
