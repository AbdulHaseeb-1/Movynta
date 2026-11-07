import { z } from "zod";
import { PROJECT_CATEGORIES, type ProjectSort } from "@movynta/contracts";

export const projectCategoryIdSchema = z.enum(PROJECT_CATEGORIES);
export type ProjectCategoryId = z.infer<typeof projectCategoryIdSchema>;

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
export type Project = z.infer<typeof projectSchema>;
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

export const projectConversationSchema = z.object({
  sessionId: z.string().optional(),
  provider: z
    .object({ id: z.string(), model: z.string(), baseUrl: z.string() })
    .optional(),
  messages: z.array(
    z.object({
      runId: z.string(),
      prompt: z.string(),
      reply: z.string().optional(),
      attachments: z
        .array(z.object({ name: z.string(), mediaType: z.string(), bytes: z.number() }))
        .default([]),
      status: z.enum([
        "created",
        "running",
        "waiting_approval",
        "completed",
        "failed",
        "cancelled",
      ]),
      error: z.string().optional(),
      createdAt: z.string(),
    }),
  ),
});
export type ProjectConversation = z.infer<typeof projectConversationSchema>;

/** The tabs of the library: the working set, the starred ones among it, and the archive. */
export type ProjectView = "all" | "starred" | "archived";
export type { ProjectSort };

export interface ProjectFilters {
  search: string;
  category: ProjectCategoryId | "all";
  view: ProjectView;
  sort: ProjectSort;
}

export const defaultProjectFilters: ProjectFilters = {
  search: "",
  category: "all",
  view: "all",
  sort: "updated",
};

/** Something the user can do to a project from a menu. */
export type ProjectAction =
  | "open"
  | "rename"
  | "star"
  | "duplicate"
  | "archive"
  | "delete";
