/**
 * The project the studio should load for an address. A workspace that has just created its project already shows
 * it, so while the address only follows that project there is nothing to load.
 */
export function projectToOpen(projectId: string | undefined, created: string | undefined): string | undefined {
  return projectId && projectId !== created ? projectId : undefined;
}

/**
 * Which project the workspace still counts as its own after the address changed. Once the address is another
 * project (a duplicate, say), the workspace has left the one it created, so coming back to it must load it again
 * instead of showing a blank workspace.
 */
export function createdAfterNavigation(projectId: string | undefined, created: string | undefined): string | undefined {
  return projectId && projectId !== created ? undefined : created;
}
