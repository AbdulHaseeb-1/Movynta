/**
 * What a project is for. Each category opens its own workspace in the desktop app. Add a value here
 * (and its entry in the app's category catalog) to introduce a new kind of project.
 */
export const PROJECT_CATEGORIES = ["design"] as const;
export type ProjectCategory = (typeof PROJECT_CATEGORIES)[number];

export const PROJECT_SORTS = ["updated", "created", "name"] as const;
export type ProjectSort = (typeof PROJECT_SORTS)[number];

/** Which projects a listing includes: the working set, the archive, or both. */
export const PROJECT_SCOPES = ["active", "archived", "all"] as const;
export type ProjectScope = (typeof PROJECT_SCOPES)[number];
