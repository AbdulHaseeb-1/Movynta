import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { ConflictError, NotFoundError, ValidationFailedError } from "../../common/errors/app-error.js";
import { isOneOf } from "../../shared/guards/enum.guard.js";
import { editorCommandListSchema } from "../../shared/schemas/editor-command.schema.js";
import { ProjectScenesService } from "./project-scenes.service.js";
import { ProjectsRepository } from "./projects.repository.js";
import {
  ASSET_FORMATS,
  DEFAULT_PROJECT_CATEGORY,
  MAX_ASSET_BYTES,
  PROJECT_NAME_MAX_LENGTH,
  type ProjectCategory,
  type ProjectConversation,
  type ProjectListQuery,
  type ProjectPatch,
  type ProjectRecord,
  type ProjectView,
  type SceneImport,
  type SceneStep,
  type StoredAsset,
} from "./projects.types.js";

const OBJECT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const ASSET_NAME_MAX_LENGTH = 160;
/** The changes a user can make by hand and have saved with the project. */
const USER_EDIT_TYPES: ReadonlySet<string> = new Set(["scene.transform_object", "scene.delete_object", "geometry.set_modifiers", "geometry.create_primitive"]);

/** An uploaded model, before it is checked. */
export interface ModelUpload {
  readonly name: string;
  readonly format: string;
  readonly objectId: string;
  readonly content: Uint8Array;
}

/** Binary glTF starts with the ASCII magic "glTF"; a mislabeled file is caught before it is stored. */
function hasExpectedHeader(format: string, content: Uint8Array): boolean {
  return format !== "glb" || (content.length >= 4 && Buffer.from(content.subarray(0, 4)).toString("latin1") === "glTF");
}

/** Collapses whitespace and strips control characters, so text stays on one tidy line. */
export function tidyText(input: string): string {
  // eslint-disable-next-line no-control-regex -- control characters are exactly what is being removed.
  return input.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
}

export function normalizeProjectName(input: string): string {
  const name = tidyText(input);
  if (name.length > PROJECT_NAME_MAX_LENGTH) {
    throw new ValidationFailedError(`Project names are limited to ${PROJECT_NAME_MAX_LENGTH} characters`);
  }
  return name;
}

/** Projects are private to the user who made them; anyone else gets 404, as if they did not exist. */
@Injectable()
export class ProjectsService {
  constructor(
    private readonly repository: ProjectsRepository,
    private readonly scenes: ProjectScenesService,
  ) {}

  /** Creates a project. Without a name it is untitled until the user names it. */
  create(userId: string, category: ProjectCategory = DEFAULT_PROJECT_CATEGORY, name = ""): ProjectView {
    const now = new Date().toISOString();
    const id = `prj_${randomUUID()}`;
    this.repository.insert({ id, userId, name: normalizeProjectName(name), category, createdAt: now, updatedAt: now });
    return this.view(userId, id);
  }

  list(userId: string, query: ProjectListQuery): ProjectView[] {
    return this.repository.list(userId, query);
  }

  get(userId: string, projectId: string): ProjectView {
    return this.view(userId, projectId);
  }

  update(userId: string, projectId: string, patch: ProjectPatch): ProjectView {
    const project = this.owned(userId, projectId);
    const now = new Date().toISOString();
    const change: { name?: string; starred?: boolean; archivedAt?: string | null } = {};
    if (patch.name !== undefined) change.name = normalizeProjectName(patch.name);
    if (patch.starred !== undefined) change.starred = patch.starred;
    if (patch.archived !== undefined) {
      // Archiving an archived project keeps its original date.
      change.archivedAt = patch.archived ? (project.archivedAt ?? now) : null;
    }
    this.repository.update(projectId, change, now, change.name !== undefined && change.name !== project.name);
    return this.view(userId, projectId);
  }

  /** A copy with the same scene. The conversation is not copied; the new project starts fresh. */
  duplicate(userId: string, projectId: string): ProjectView {
    const source = this.owned(userId, projectId);
    const copyName = source.name ? `${source.name} copy`.slice(0, PROJECT_NAME_MAX_LENGTH) : "";
    const copy = this.create(userId, source.category, copyName);
    this.scenes.copy(source.id, copy.id);
    return copy;
  }

  /** Permanently removes a project and everything in it. Refused while the assistant is working in it. */
  remove(userId: string, projectId: string): void {
    this.owned(userId, projectId);
    if (this.repository.hasActiveRun(projectId)) {
      throw new ConflictError("The assistant is still working in this project. Stop it first, then delete the project.");
    }
    this.repository.purge(projectId);
  }

  scene(userId: string, projectId: string): SceneStep[] {
    this.owned(userId, projectId);
    return this.scenes.list(projectId);
  }
  recoveryRequired(userId: string, projectId: string): boolean {
    this.owned(userId, projectId); return this.scenes.recoveryRequired(projectId);
  }

  previewHistory(userId: string, projectId: string, direction: "undo" | "redo") {
    this.owned(userId, projectId);
    if (this.repository.hasActiveRun(projectId)) throw new ConflictError("Wait for the assistant to finish before changing history");
    return this.scenes.previewHistory(projectId, direction);
  }

  commitHistory(userId: string, projectId: string, direction: "undo" | "redo", version: number, operationId: string): void {
    this.owned(userId, projectId);
    if (this.repository.hasActiveRun(projectId)) throw new ConflictError("Wait for the assistant to finish before changing history");
    this.scenes.commitHistory(projectId, direction, version, operationId);
    this.repository.touch(projectId, new Date().toISOString());
  }

  /**
   * Keeps a model file the user imported and adds it to the project's scene history. The backend does
   * not read the model; the app does, so this only checks what can be checked without parsing it.
   */
  importModel(userId: string, projectId: string, upload: ModelUpload): SceneImport {
    this.owned(userId, projectId);
    if (this.repository.hasActiveRun(projectId)) throw new ConflictError("Wait for the assistant to finish before importing");
    if (!isOneOf(ASSET_FORMATS, upload.format)) {
      throw new ValidationFailedError(`Models can be imported as ${ASSET_FORMATS.join(", ")} files`);
    }
    if (!OBJECT_ID_PATTERN.test(upload.objectId)) throw new ValidationFailedError("Invalid object id");
    if (upload.content.byteLength === 0) throw new ValidationFailedError("The file is empty");
    if (upload.content.byteLength > MAX_ASSET_BYTES) {
      throw new ValidationFailedError(`Models are limited to ${MAX_ASSET_BYTES / (1024 * 1024)} MB`);
    }
    if (!hasExpectedHeader(upload.format, upload.content)) {
      throw new ValidationFailedError("This file is not a valid GLB model");
    }
    const name = tidyText(upload.name).slice(0, ASSET_NAME_MAX_LENGTH);
    if (!name) throw new ValidationFailedError("The file needs a name");
    const step = this.scenes.addImport(projectId, {
      objectId: upload.objectId,
      name,
      format: upload.format,
      content: upload.content,
    });
    this.repository.touch(projectId, new Date().toISOString());
    return step;
  }

  /**
   * Records a change the user made to the scene by hand, so the project shows it when reopened. Only
   * transforms, modifier stacks, deletion and new primitives can be recorded this way.
   * Assistant-driven changes still go through approved proposals.
   */
  recordSceneEdit(userId: string, projectId: string, input: unknown, actionId?: string): { proposalId: string } {
    this.owned(userId, projectId);
    if (this.repository.hasActiveRun(projectId)) {
      throw new ConflictError("The assistant is working in this project. Wait for it to finish, then edit.");
    }
    const parsed = editorCommandListSchema.safeParse(input);
    if (!parsed.success) throw new ValidationFailedError("These scene changes are not valid");
    // Only the objects this batch names are looked up; the history itself is never read.
    const known = this.scenes.existingObjectIds(
      projectId,
      parsed.data.map((command) => command.objectId),
    );
    for (const command of parsed.data) {
      if (command.type === "geometry.create_primitive") {
        if (command.replaceExisting || known.has(command.objectId)) throw new ValidationFailedError("Add shapes with a new object id; replacing existing objects is not allowed here");
        known.add(command.objectId);
        continue;
      }
      if (!USER_EDIT_TYPES.has(command.type)) {
        throw new ValidationFailedError("Only new primitives, transforms, modifier stacks and deletion can be recorded here");
      }
      if (!known.has(command.objectId)) {
        throw new ValidationFailedError(`Object "${command.objectId}" is not in this project`);
      }
      // Later commands of the same batch see the scene as the earlier ones leave it.
      if (command.type === "scene.delete_object") known.delete(command.objectId);
    }
    const proposalId = `usr_${randomUUID()}`;
    this.scenes.append(projectId, proposalId, parsed.data, actionId);
    this.repository.touch(projectId, new Date().toISOString());
    return { proposalId };
  }

  model(userId: string, projectId: string, assetId: string): StoredAsset {
    this.owned(userId, projectId);
    return this.scenes.asset(projectId, assetId);
  }

  conversation(userId: string, projectId: string): ProjectConversation {
    this.owned(userId, projectId);
    return this.repository.conversation(projectId);
  }

  private owned(userId: string, projectId: string): ProjectRecord {
    const project = this.repository.find(projectId);
    if (!project || project.userId !== userId) throw new NotFoundError("Project not found");
    return project;
  }

  private view(userId: string, projectId: string): ProjectView {
    this.owned(userId, projectId);
    const view = this.repository.view(projectId);
    if (!view) throw new NotFoundError("Project not found");
    return view;
  }
}
