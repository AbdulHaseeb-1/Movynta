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

export function loadPanelVisibility(): PanelVisibility {
  const defaults: PanelVisibility = {
    assistant: false,
    scene: false,
    meshSelection: false,
    modifiers: false,
    properties: false,
  };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaults;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return defaults;
    for (const [key, value] of Object.entries(parsed)) {
      const id = PANEL_IDS.find((panel) => panel === key);
      if (id && typeof value === "boolean") defaults[id] = value;
    }
  } catch {
    /* Storage can be unavailable; use defaults. */
  }
  return defaults;
}
export function savePanelVisibility(visibility: PanelVisibility): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(visibility));
  } catch {
    /* Preferences are optional. */
  }
}
