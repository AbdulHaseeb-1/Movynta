import type { Project } from "./projectTypes";

/** The name shown for a project that has no name. */
export const UNTITLED_PROJECT = "Untitled project";
/** The longest project name, in characters. */
export const PROJECT_NAME_MAX_LENGTH = 80;

/** Whether a project has no name, so it is shown as untitled. */
export function isUntitled(project: Pick<Project, "name">): boolean {
  return project.name.trim() === "";
}

/** What to show as the project's title. Projects stay untitled until the user names them. */
export function displayName(project: Pick<Project, "name">): string {
  return isUntitled(project) ? UNTITLED_PROJECT : project.name;
}
