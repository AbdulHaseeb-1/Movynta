import { Sparkles, type LucideIcon } from "lucide-react";
import type { Project, ProjectCategoryId } from "./projectTypes";

/** What the app shows about a project category: its name and description. */
export interface ProjectCategoryInfo {
  id: ProjectCategoryId;
  label: string;
  /** One line shown where the user picks a category. */
  description: string;
  icon: LucideIcon;
  /** The workspace route for a new project, or for an existing one when given its id. */
  workspacePath: (projectId?: string) => string;
}

/**
 * Every kind of project the app knows. To add a category: extend the schema in `projectTypes.ts`
 * and the backend's `PROJECT_CATEGORIES`, then describe it here and give it a route.
 */
export const PROJECT_CATEGORY_CATALOG: Readonly<Record<ProjectCategoryId, ProjectCategoryInfo>> = {
  design: {
    id: "design",
    label: "Design",
    description: "Shape characters and objects in 3D with the assistant.",
    icon: Sparkles,
    workspacePath: (projectId) => (projectId ? `/studio/${projectId}` : "/studio"),
  },
};

/** The catalogue of project categories. */
export const projectCategories: readonly ProjectCategoryInfo[] = Object.values(PROJECT_CATEGORY_CATALOG);

/** The catalogue entry for a project category. */
export function categoryOf(id: ProjectCategoryId): ProjectCategoryInfo {
  return PROJECT_CATEGORY_CATALOG[id];
}

/** Where a project opens. */
export function projectPath(project: Pick<Project, "id" | "category">) {
  return categoryOf(project.category).workspacePath(project.id);
}
