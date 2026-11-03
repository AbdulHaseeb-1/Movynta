import type { EditorCommand } from "../../shared/types/editor-command.types.js";

/**
 * What a project is for. Each category opens its own workspace in the desktop app. Add a value here
 * (and its entry in the app's category catalog) to introduce a new kind of project.
 */
export const PROJECT_CATEGORIES = ["design"] as const;
export type ProjectCategory = (typeof PROJECT_CATEGORIES)[number];
export const DEFAULT_PROJECT_CATEGORY: ProjectCategory = "design";

export const PROJECT_NAME_MAX_LENGTH = 80;
export const PROJECT_SORTS = ["updated", "created", "name"] as const;
export type ProjectSort = (typeof PROJECT_SORTS)[number];
/** Which projects a listing includes: the working set, the archive, or both. */
export const PROJECT_SCOPES = ["active", "archived", "all"] as const;
export type ProjectScope = (typeof PROJECT_SCOPES)[number];

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

export interface ProjectListQuery {
  readonly search: string | undefined;
  readonly category: ProjectCategory | undefined;
  readonly scope: ProjectScope;
  readonly starredOnly: boolean;
  readonly sort: ProjectSort;
}

export interface ProjectPatch {
  readonly name?: string;
  readonly starred?: boolean;
  readonly archived?: boolean;
}

/** Model formats the app can open. The files are parsed in the app; the backend only keeps them. */
export const ASSET_FORMATS = ["glb", "gltf", "obj", "fbx", "stl", "ply", "dae"] as const;
export type AssetFormat = (typeof ASSET_FORMATS)[number];
/** The largest model file accepted, and how much one project may hold in total. */
export const MAX_ASSET_BYTES = 64 * 1024 * 1024;
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

export interface NewAsset {
  readonly objectId: string;
  readonly name: string;
  readonly format: AssetFormat;
  readonly content: Uint8Array;
}

export interface StoredAsset {
  readonly name: string;
  readonly format: AssetFormat;
  readonly content: Uint8Array;
}

export type ProjectMessageStatus =
  | "created"
  | "running"
  | "waiting_approval"
  | "completed"
  | "failed"
  | "cancelled";

/** One request and its reply, which is how a project's chat is restored. */
export interface ProjectMessage {
  readonly runId: string;
  readonly prompt: string;
  readonly reply: string | undefined;
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

export interface ProjectConversation {
  /** The session to continue, or undefined when nothing has been asked yet. */
  readonly sessionId: string | undefined;
  readonly provider: ProjectConversationProvider | undefined;
  readonly messages: readonly ProjectMessage[];
}
