/** The documentation page with a workspace tool's guide entry scrolled into view and its example open. */
export function guidePath(toolId: string): string {
  return `/documentation?tool=${encodeURIComponent(toolId)}`;
}

/** The documentation page on its Shortcuts tab, where a key press can be looked up. */
export const SHORTCUTS_PATH = "/documentation?area=shortcuts";
