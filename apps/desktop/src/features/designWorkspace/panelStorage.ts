import { z } from "zod";
import { readStored, writeStored } from "@/lib/storage";

export const PANEL_IDS = [
  "assistant",
  "scene",
  "meshSelection",
  "modifiers",
  "properties",
] as const;
export type PanelId = (typeof PANEL_IDS)[number];
export type PanelVisibility = Record<PanelId, boolean>;
const KEY = "movynta.workspace.panels.v1";
const savedSchema = z.record(z.string(), z.unknown());

/** The open state of each panel. A saved panel with a valid value is restored; any other panel keeps its default. */
export function loadPanelVisibility(): PanelVisibility {
  const visibility: PanelVisibility = {
    assistant: false,
    scene: false,
    meshSelection: false,
    modifiers: false,
    properties: false,
  };
  const saved: Record<string, unknown> = readStored(KEY, savedSchema) ?? {};
  for (const id of PANEL_IDS) {
    const value = saved[id];
    if (typeof value === "boolean") visibility[id] = value;
  }
  return visibility;
}

export function savePanelVisibility(visibility: PanelVisibility): void {
  writeStored(KEY, visibility);
}
