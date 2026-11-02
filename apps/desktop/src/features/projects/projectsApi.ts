import { z } from "zod";
import { backendRequest } from "@/lib/backend";
import {
  projectConversationSchema,
  projectSceneSchema,
  projectSchema,
  projectsSchema,
  type Project,
  type ProjectCategoryId,
  type ProjectConversation,
  type ProjectFilters,
} from "./projectTypes";

/** Turns the library's filters into the backend's query. Empty values are left out. */
export function listQuery(filters: ProjectFilters): string {
  const params = new URLSearchParams();
  const search = filters.search.trim();
  if (search) params.set("search", search);
  if (filters.category !== "all") params.set("category", filters.category);
  params.set("scope", filters.view === "archived" ? "archived" : "active");
  if (filters.view === "starred") params.set("starred", "true");
  params.set("sort", filters.sort);
  return params.toString();
}

export function listProjects(
  filters: ProjectFilters,
  signal?: AbortSignal,
): Promise<Project[]> {
  return backendRequest(
    `/projects?${listQuery(filters)}`,
    projectsSchema,
    "GET",
    undefined,
    signal,
  );
}

export function getProject(id: string): Promise<Project> {
  return backendRequest(`/projects/${id}`, projectSchema);
}

export function createProject(category: ProjectCategoryId): Promise<Project> {
  return backendRequest("/projects", projectSchema, "POST", { category });
}

export function updateProject(
  id: string,
  patch: { name?: string; starred?: boolean; archived?: boolean },
): Promise<Project> {
  return backendRequest(`/projects/${id}`, projectSchema, "PATCH", patch);
}

export function duplicateProject(id: string): Promise<Project> {
  return backendRequest(`/projects/${id}/duplicate`, projectSchema, "POST");
}

export function deleteProject(id: string): Promise<void> {
  return backendRequest(`/projects/${id}`, z.void(), "DELETE");
}

export function getProjectScene(id: string) {
  return backendRequest(`/projects/${id}/scene`, projectSceneSchema);
}

export function getProjectConversation(
  id: string,
): Promise<ProjectConversation> {
  return backendRequest(
    `/projects/${id}/conversation`,
    projectConversationSchema,
  );
}
