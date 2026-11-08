import type { EditorCommand } from "@movynta/editor-protocol";

import type { AttachmentSummary, ProjectCategory, ProjectScope, ProjectSort } from "@movynta/contracts";

// The category, sort and scope lists are shared with the desktop app; these re-exports keep this module's public names.
export { PROJECT_CATEGORIES, PROJECT_SCOPES, PROJECT_SORTS } from "@movynta/contracts";
/** The project category, scope and sort types, shared with the desktop app. */
export type { ProjectCategory, ProjectScope, ProjectSort } from "@movynta/contracts";

/** The category a new project gets when none is given. */
export const DEFAULT_PROJECT_CATEGORY: ProjectCategory = "design";

/** The longest project name, in characters. */
export const PROJECT_NAME_MAX_LENGTH = 80;

/** A project as stored. An empty name means the user has not named it yet. */
export interface ProjectRecord {
  readonly id: string;
  readonly userId: string;
  readonly name: string;
  readonly category: ProjectCategory;
  readonly starred: boolean;
  readonly archivedAt: string | undefined;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** A project as clients see it, with a little context so unnamed projects are still recognizable. */
export interface ProjectView {
  readonly id: string;
  readonly name: string;
  readonly category: ProjectCategory;
  readonly starred: boolean;
  readonly archived: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** How many requests have been made in this project. */
  readonly runCount: number;
  /** The first request, shortened. Empty until the first prompt. */
  readonly firstPrompt: string;
}

/** The filters and sort used to list projects. */
export interface ProjectListQuery {
  readonly search: string | undefined;
  readonly category: ProjectCategory | undefined;
  readonly scope: ProjectScope;
  readonly starredOnly: boolean;
  readonly sort: ProjectSort;
}

/** The fields that may change on a project. */
export interface ProjectPatch {
  readonly name?: string;
  readonly starred?: boolean;
  readonly archived?: boolean;
}

/** Model formats the app can open. The files are parsed in the app; the backend only keeps them. */
export const ASSET_FORMATS = ["glb", "gltf", "obj", "fbx", "stl", "ply", "dae"] as const;
/** The model file formats a project can import. */
export type AssetFormat = (typeof ASSET_FORMATS)[number];
/** The largest model file accepted, and how much one project may hold in total. */
export const MAX_ASSET_BYTES = 64 * 1024 * 1024;
/** The largest imported model file, in bytes. */
export const MAX_PROJECT_ASSET_BYTES = 256 * 1024 * 1024;

/** One applied batch of editor commands. */
export interface SceneBatch {
  readonly kind: "commands";
  readonly proposalId: string;
  readonly commands: readonly EditorCommand[];
}

/** A model the user imported. The file itself is fetched separately by `assetId`. */
export interface SceneImport {
  readonly kind: "import";
  readonly assetId: string;
  readonly objectId: string;
  readonly name: string;
  readonly format: AssetFormat;
}

/** One change to a project's scene. Replaying the steps in order rebuilds it. */
export type SceneStep = SceneBatch | SceneImport;

/** What is needed to store an imported model file. */
export interface NewAsset {
  readonly objectId: string;
  readonly name: string;
  readonly format: AssetFormat;
  readonly content: Uint8Array;
}

/** An imported model file as it is stored. */
export interface StoredAsset {
  readonly name: string;
  readonly format: AssetFormat;
  readonly content: Uint8Array;
}

/** The status of a request in a project's chat. */
export type ProjectMessageStatus = "created" | "running" | "waiting_approval" | "completed" | "failed" | "cancelled";

/** One request and its reply, which is how a project's chat is restored. */
export interface ProjectMessage {
  readonly runId: string;
  readonly prompt: string;
  readonly reply: string | undefined;
  /** The pictures attached to the request, by name; their pixels are not kept. */
  readonly attachments: readonly AttachmentSummary[];
  readonly status: ProjectMessageStatus;
  readonly error: string | undefined;
  readonly createdAt: string;
}

/** The model that produced the latest reply. A session can only be continued with the same one. */
export interface ProjectConversationProvider {
  readonly id: string;
  readonly model: string;
  readonly baseUrl: string;
}

/** The saved chat of a project: its latest session and its requests, oldest first. */
export interface ProjectConversation {
  /** The session to continue, or undefined when nothing has been asked yet. */
  readonly sessionId: string | undefined;
  readonly provider: ProjectConversationProvider | undefined;
  readonly messages: readonly ProjectMessage[];
}
