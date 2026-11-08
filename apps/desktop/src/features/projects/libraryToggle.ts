import type { ProjectsStatus } from "./projectsSlice";

/**
 * Whether the "View all" / "Show less" button is shown. It stays while a list is loading: every change of the
 * filters reloads the list, and a button that vanishes mid-click takes keyboard focus with it.
 */
export function libraryToggleVisible(connected: boolean, status: ProjectsStatus): boolean {
  return connected && (status === "ready" || status === "loading");
}
