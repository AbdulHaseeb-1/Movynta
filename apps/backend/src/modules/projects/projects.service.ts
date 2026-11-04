import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { ConflictError, NotFoundError, ValidationFailedError } from "../../common/errors/app-error.js";
import { isOneOf } from "../../shared/guards/enum.guard.js";
import { editorCommandListSchema } from "../../shared/schemas/editor-command.schema.js";
import { collectionKey, ProjectScenesService } from "./project-scenes.service.js";
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
const USER_EDIT_TYPES: ReadonlySet<string> = new Set(["scene.transform_object", "scene.set_visibility", "scene.rename_object", "scene.set_parent", "scene.delete_object", "scene.create_collection", "scene.rename_collection", "scene.set_collection_visibility", "scene.move_collection", "scene.delete_collection", "scene.move_to_collection", "geometry.set_modifiers", "geometry.create_primitive", "geometry.extrude", "geometry.transform_faces", "geometry.subdivide_faces"]);

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
   * transforms, renaming, re-parenting, collections, visibility, modifier stacks, extrusion, deletion and new
   * primitives can be recorded this way. The objects a command names, and the parent it names, must be in the project; the
   * editor has already checked that the change fits the scene (it prepares it before it is saved).
   * Assistant-driven changes still go through approved proposals.
   */
  recordSceneEdit(userId: string, projectId: string, input: unknown, actionId?: string): { proposalId: string } {
    this.owned(userId, projectId);
    if (this.repository.hasActiveRun(projectId)) {
      throw new ConflictError("The assistant is working in this project. Wait for it to finish, then edit.");
    }
    const parsed = editorCommandListSchema.safeParse(input);
    if (!parsed.success) throw new ValidationFailedError("These scene changes are not valid");
    // Only the objects and collections this batch names, and the parents it names, are looked up; the history itself
    // is never read. Collections are in the same index under their own keys.
    const known = this.scenes.existingObjectIds(
      projectId,
      parsed.data.flatMap((command) => {
        const keys: string[] = [];
        if ("objectId" in command) keys.push(command.objectId);
        if ("parentId" in command && typeof command.parentId === "string") keys.push(command.parentId);
        for (const id of [("collectionId" in command ? command.collectionId : undefined), ("parentCollectionId" in command ? command.parentCollectionId : undefined)]) {
          if (typeof id === "string") keys.push(collectionKey(id));
        }
        return keys;
      }),
    );
    const requireCollection = (id: string | null | undefined) => {
      if (typeof id === "string" && !known.has(collectionKey(id))) throw new ValidationFailedError(`Collection "${id}" is not in this project`);
    };
    for (const command of parsed.data) {
      // A parent is an object of the project, or one this batch added earlier. Moving to the top level names none.
      const parentId = "parentId" in command ? command.parentId : undefined;
      if (typeof parentId === "string" && !known.has(parentId)) {
        throw new ValidationFailedError(`Object "${parentId}" is not in this project`);
      }
      if (command.type === "geometry.create_primitive") {
        if (command.replaceExisting || known.has(command.objectId)) throw new ValidationFailedError("Add shapes with a new object id; replacing existing objects is not allowed here");
        requireCollection(command.collectionId);
        known.add(command.objectId);
        continue;
      }
      if (!USER_EDIT_TYPES.has(command.type)) {
        throw new ValidationFailedError("Only new primitives, transforms, renaming, re-parenting, collections, visibility, modifier stacks, extrusion and deletion can be recorded here");
      }
      if (command.type === "scene.create_collection") {
        if (known.has(collectionKey(command.collectionId))) throw new ValidationFailedError(`Collection "${command.collectionId}" is already in this project; use a new id`);
        requireCollection(command.parentCollectionId);
        known.add(collectionKey(command.collectionId));
        continue;
      }
      if ("collectionId" in command && !("objectId" in command)) {
        // Renaming, hiding, moving and deleting name a collection that must be there.
        requireCollection(command.collectionId);
        if ("parentCollectionId" in command) requireCollection(command.parentCollectionId);
        if (command.type === "scene.delete_collection") known.delete(collectionKey(command.collectionId));
        continue;
      }
      if (!("objectId" in command) || !known.has(command.objectId)) {
        throw new ValidationFailedError(`Object "${"objectId" in command ? command.objectId : ""}" is not in this project`);
      }
      if (command.type === "scene.move_to_collection") requireCollection(command.collectionId);
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
