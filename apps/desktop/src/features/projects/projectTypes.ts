import { z } from "zod";
import { PROJECT_CATEGORIES, type ProjectSort } from "@movynta/contracts";

/** The schema for a project category id. */
export const projectCategoryIdSchema = z.enum(PROJECT_CATEGORIES);
/** The id of a project category. */
export type ProjectCategoryId = z.infer<typeof projectCategoryIdSchema>;

/** The schema for a project as the backend returns it. */
export const projectSchema = z.object({
  id: z.string(),
  /** Empty until the user names the project. */
  name: z.string(),
  category: projectCategoryIdSchema,
  starred: z.boolean(),
  archived: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  runCount: z.number().int().nonnegative(),
  /** The first request made in the project, shortened by the backend. */
  firstPrompt: z.string(),
});
/** A project as the app knows it. */
export type Project = z.infer<typeof projectSchema>;
/** The schema for a list of projects. */
export const projectsSchema = z.array(projectSchema);

/**
 * What happened to the scene, in order: command batches the editor applied, and models the user
 * imported. The editor validates the commands when it replays them.
 */
export const projectSceneSchema = z.object({
  steps: z.array(
    z.discriminatedUnion("kind", [
      z.object({
        kind: z.literal("commands"),
        proposalId: z.string(),
        commands: z.unknown(),
      }),
      z.object({
        kind: z.literal("import"),
        assetId: z.string(),
        objectId: z.string(),
        name: z.string(),
        format: z.string(),
      }),
    ]),
  ),
});

/** The schema for a project's saved chat. */
export const projectConversationSchema = z.object({
  sessionId: z.string().optional(),
  provider: z.object({ id: z.string(), model: z.string(), baseUrl: z.string() }).optional(),
  messages: z.array(
    z.object({
      runId: z.string(),
      prompt: z.string(),
      reply: z.string().optional(),
      attachments: z.array(z.object({ name: z.string(), mediaType: z.string(), bytes: z.number() })).default([]),
      status: z.enum(["created", "running", "waiting_approval", "completed", "failed", "cancelled"]),
      error: z.string().optional(),
      createdAt: z.string(),
    }),
  ),
});
/** A project's saved chat: its session and its requests. */
export type ProjectConversation = z.infer<typeof projectConversationSchema>;

/** The tabs of the library: the working set, the starred ones among it, and the archive. */
export type ProjectView = "all" | "starred" | "archived";
/** The sort order of the library. */
export type { ProjectSort };

/** The search, category, view and sort that filter the library. */
export interface ProjectFilters {
  search: string;
  category: ProjectCategoryId | "all";
  view: ProjectView;
  sort: ProjectSort;
}

/** The library filters used before the user changes them. */
export const defaultProjectFilters: ProjectFilters = {
  search: "",
  category: "all",
  view: "all",
  sort: "updated",
};

/** Something the user can do to a project from a menu. */
export type ProjectAction = "open" | "rename" | "star" | "duplicate" | "archive" | "delete";

/**
 * Called when the user picks something to do to a project. `opener` is the control that was used, so a dialog
 * the action opens can give focus back to it when it closes.
 */
export type ProjectActionHandler = (action: ProjectAction, project: Project, opener?: HTMLElement | null) => void;
