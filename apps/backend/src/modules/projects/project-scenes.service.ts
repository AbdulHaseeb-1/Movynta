import type { DatabaseSync, StatementSync } from "node:sqlite";
import { Injectable } from "@nestjs/common";
import { editsExistingGeometry, type EditorCommand } from "@movynta/editor-protocol";
import { ConflictError, NotFoundError } from "../../common/errors/app-error.js";
import { DatabaseService } from "../persistence/database.service.js";
import { blobColumn, integerColumn, textColumn } from "../persistence/row.js";
import { requireOneOf } from "../../shared/guards/enum.guard.js";

import {
  ASSET_FORMATS,
  MAX_PROJECT_ASSET_BYTES,
  type NewAsset,
  type SceneImport,
  type SceneStep,
  type StoredAsset,
} from "./projects.types.js";
import { newId } from "../../common/ids/index.js";

/** Prepared statements, kept per connection: preparing one costs more than running it on a small table. */
const statements = new WeakMap<DatabaseSync, Map<string, StatementSync>>();
function statement(db: DatabaseSync, sql: string): StatementSync {
  let cache = statements.get(db);
  if (!cache) {
    cache = new Map();
    statements.set(db, cache);
  }
  let prepared = cache.get(sql);
  if (!prepared) {
    prepared = db.prepare(sql);
    cache.set(sql, prepared);
  }
  return prepared;
}

/**
 * The next position in a project's history, shared by commands and imports so their order is kept.
 * Each table is asked for its own last position, which is a seek to the end of an index. Taking the
 * maximum over both tables at once makes the database read every step of the history.
 */
function nextSeq(db: DatabaseSync, projectId: string): number {
  const row = statement(
    db,
    `SELECT MAX(
         COALESCE((SELECT MAX(seq) FROM project_scene_batches WHERE project_id = ?), 0),
         COALESCE((SELECT MAX(seq) FROM project_assets WHERE project_id = ?), 0)
       ) AS last`,
  ).get(projectId, projectId);
  return (row ? integerColumn(row, "last") : 0) + 1;
}

/**
 * Stored commands were checked against the command schema before they were saved, by the assistant's
 * tools or by the route that records the user's edits. Reading them back only needs to confirm they
 * have the shape of a command list, which is far cheaper than validating every field again.
 */
function isStoredCommandList(value: unknown): value is EditorCommand[] {
  return (
    Array.isArray(value) &&
    value.every(
      (command: unknown) =>
        typeof command === "object" &&
        command !== null &&
        "type" in command &&
        typeof command.type === "string" &&
        "commandId" in command &&
        typeof command.commandId === "string",
    )
  );
}

/**
 * Collections are kept in the same index as objects, under a key that no object id can have (ids hold no ":"), so
 * that duplicating, undoing, redoing and rebuilding a project need nothing of their own to cover them.
 */
export function collectionKey(collectionId: string): string {
  return `collection:${collectionId}`;
}

/** Commands that change an object or collection that already exists, so they add and remove nothing from the index. */
function changesExistingObject(command: EditorCommand): boolean {
  return (
    command.type === "scene.rename_collection" ||
    command.type === "scene.set_collection_visibility" ||
    command.type === "scene.move_collection" ||
    command.type === "scene.move_to_collection" ||
    command.type === "scene.transform_object" ||
    command.type === "scene.move_object" ||
    editsExistingGeometry(command) ||
    command.type === "scene.rename_object" ||
    command.type === "scene.set_visibility" ||
    command.type === "scene.set_parent"
  );
}

/** Keeps `objects` in step with what `commands` create and delete. */
function trackObjects(db: DatabaseSync, projectId: string, commands: readonly EditorCommand[]): void {
  for (const command of commands) {
    if (command.type === "scene.duplicate_hierarchy") {
      for (const copy of command.copies)
        for (const id of [copy.objectId, ...copy.descendants.map((entry) => entry.objectId)])
          statement(db, "INSERT OR IGNORE INTO project_objects (project_id, object_id) VALUES (?, ?)").run(
            projectId,
            id,
          );
      continue;
    }
    if (command.type === "geometry.separate_faces") {
      statement(db, "INSERT OR IGNORE INTO project_objects (project_id, object_id) VALUES (?, ?)").run(
        projectId,
        command.newObjectId,
      );
      continue;
    }
    if (command.type === "scene.create_collection") {
      statement(db, "INSERT OR IGNORE INTO project_objects (project_id, object_id) VALUES (?, ?)").run(
        projectId,
        collectionKey(command.collectionId),
      );
      continue;
    }
    if (command.type === "scene.delete_collection") {
      statement(db, "DELETE FROM project_objects WHERE project_id = ? AND object_id = ?").run(
        projectId,
        collectionKey(command.collectionId),
      );
      continue;
    }
    if (changesExistingObject(command) || !("objectId" in command)) continue;
    if (command.type === "scene.delete_object")
      statement(db, "DELETE FROM project_objects WHERE project_id = ? AND object_id = ?").run(
        projectId,
        command.objectId,
      );
    else
      statement(db, "INSERT OR IGNORE INTO project_objects (project_id, object_id) VALUES (?, ?)").run(
        projectId,
        command.objectId,
      );
  }
}

/**
 * The scene of a project, kept as the ordered steps that built it: the command batches the editor
 * applied and the models the user imported. Replaying them on an empty scene rebuilds it, so a
 * project can be reopened or duplicated without storing meshes. Projects that were never created
 * through the projects API have no scene record.
 */
@Injectable()
export class ProjectScenesService {
  constructor(private readonly database: DatabaseService) {}

  /** Records a batch the editor applied. Ignored for ids that are not stored projects. */
  append(projectId: string, proposalId: string, commands: readonly EditorCommand[], actionId?: string): void {
    this.database.transaction((db) => {
      this.appendInTransaction(db, projectId, proposalId, commands);
      if (actionId)
        db.prepare("UPDATE project_scene_batches SET action_id = ? WHERE project_id = ? AND proposal_id = ?").run(
          actionId,
          projectId,
          proposalId,
        );
    });
  }

  /** Append as part of a caller's transaction, so proposal status and history commit together. */
  appendInTransaction(
    db: DatabaseSync,
    projectId: string,
    proposalId: string,
    commands: readonly EditorCommand[],
  ): void {
    // One lookup both confirms the project exists and tells whether its object index is built.
    const project = statement(db, "SELECT objects_indexed FROM projects WHERE id = ?").get(projectId);
    if (!project) return;
    this.branch(db, projectId);
    if (integerColumn(project, "objects_indexed") !== 1) this.ensureObjectsIndexed(db, projectId);
    statement(
      db,
      "INSERT INTO project_scene_batches (project_id, seq, proposal_id, commands_json, applied_at) VALUES (?, ?, ?, ?, ?)",
    ).run(projectId, nextSeq(db, projectId), proposalId, JSON.stringify(commands), new Date().toISOString());
    trackObjects(db, projectId, commands);
  }

  /** Stores an imported model as the next step of the project. The project must exist. */
  addImport(projectId: string, asset: NewAsset): SceneImport {
    const assetId = newId("ast");
    this.database.transaction((db) => {
      this.branch(db, projectId);
      this.ensureObjectsIndexed(db, projectId);
      const used = db
        .prepare("SELECT COALESCE(SUM(size), 0) AS used FROM project_assets WHERE project_id = ?")
        .get(projectId);
      if ((used ? integerColumn(used, "used") : 0) + asset.content.byteLength > MAX_PROJECT_ASSET_BYTES) {
        throw new ConflictError(
          "This project has reached its limit for imported models, including models needed by undo history. Undo an import and make a new edit, or start a new project.",
        );
      }
      const taken = db
        .prepare("SELECT 1 AS found FROM project_assets WHERE project_id = ? AND object_id = ? AND history_state = 0")
        .get(projectId, asset.objectId);
      if (taken) throw new ConflictError("That object id is already used by another import");
      db.prepare(
        "INSERT INTO project_assets (id, project_id, seq, object_id, name, format, size, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(
        assetId,
        projectId,
        nextSeq(db, projectId),
        asset.objectId,
        asset.name,
        asset.format,
        asset.content.byteLength,
        asset.content,
        new Date().toISOString(),
      );
      db.prepare("INSERT OR IGNORE INTO project_objects (project_id, object_id) VALUES (?, ?)").run(
        projectId,
        asset.objectId,
      );
    });
    return { kind: "import", assetId, objectId: asset.objectId, name: asset.name, format: asset.format };
  }

  /**
   * Which of `objectIds` exist in the project once every step so far is replayed. The answer comes from
   * an index kept as the history grows, so it costs what the question costs, not what the history costs.
   */
  existingObjectIds(projectId: string, objectIds: readonly string[]): Set<string> {
    const wanted = [...new Set(objectIds)];
    if (wanted.length === 0) return new Set();
    return this.database.transaction((db) => {
      this.ensureObjectsIndexed(db, projectId);
      const marks = wanted.map(() => "?").join(", ");
      return new Set(
        statement(db, `SELECT object_id FROM project_objects WHERE project_id = ? AND object_id IN (${marks})`)
          .all(projectId, ...wanted)
          .map((row) => textColumn(row, "object_id")),
      );
    });
  }

  /** Builds the object index of a project that was stored before the index existed. Once, then it is kept. */
  private ensureObjectsIndexed(db: DatabaseSync, projectId: string): void {
    const flag = statement(db, "SELECT objects_indexed FROM projects WHERE id = ?").get(projectId);
    if (!flag || integerColumn(flag, "objects_indexed") === 1) return;
    db.prepare("DELETE FROM project_objects WHERE project_id = ?").run(projectId);
    for (const step of this.listFrom(db, projectId)) {
      if (step.kind === "import")
        db.prepare("INSERT OR IGNORE INTO project_objects (project_id, object_id) VALUES (?, ?)").run(
          projectId,
          step.objectId,
        );
      else trackObjects(db, projectId, step.commands);
    }
    db.prepare("UPDATE projects SET objects_indexed = 1 WHERE id = ?").run(projectId);
  }

  asset(projectId: string, assetId: string): StoredAsset {
    const row = this.database.db
      .prepare("SELECT name, format, content FROM project_assets WHERE project_id = ? AND id = ?")
      .get(projectId, assetId);
    if (!row) throw new NotFoundError("Imported model not found");
    return {
      name: textColumn(row, "name"),
      format: requireOneOf(ASSET_FORMATS, textColumn(row, "format"), "asset format"),
      content: blobColumn(row, "content"),
    };
  }

  /** Every step of the scene in the order it happened. */
  list(projectId: string): SceneStep[] {
    return this.listFrom(this.database.db, projectId);
  }
  recoveryRequired(projectId: string): boolean {
    return (
      this.database.db
        .prepare("SELECT 1 FROM editor_proposals WHERE project_id = ? AND delivery_pending = 1 LIMIT 1")
        .get(projectId) !== undefined
    );
  }

  /** State 0 is active, 1 is redoable, 2 belongs to an abandoned redo branch. */
  private branch(db: DatabaseSync, projectId: string): void {
    for (const table of ["project_scene_batches", "project_assets"]) {
      db.prepare(`UPDATE ${table} SET history_state = 2 WHERE project_id = ? AND history_state = 1`).run(projectId);
    }
    // Abandoned imports can no longer be replayed or redone. Reclaim their blobs in the
    // same transaction as the new edit, so a failed edit still preserves redo history.
    db.prepare("DELETE FROM project_assets WHERE project_id = ? AND history_state = 2").run(projectId);
    db.prepare("UPDATE projects SET scene_version = scene_version + 1 WHERE id = ?").run(projectId);
  }

  history(projectId: string, direction?: "undo" | "redo") {
    const db = this.database.db;
    const row = db.prepare("SELECT scene_version FROM projects WHERE id = ?").get(projectId);
    const entries = db
      .prepare(
        `SELECT b.seq, b.history_state, COALESCE(p.run_id, b.action_id, b.proposal_id) AS action FROM project_scene_batches b
      LEFT JOIN editor_proposals p ON p.id = b.proposal_id WHERE b.project_id = ? AND b.history_state < 2
      UNION ALL SELECT seq, history_state, id AS action FROM project_assets WHERE project_id = ? AND history_state < 2 ORDER BY seq`,
      )
      .all(projectId, projectId);
    const target =
      direction === "undo"
        ? entries.filter((entry) => Number(entry["history_state"]) === 0).at(-1)
        : direction === "redo"
          ? entries.find((entry) => Number(entry["history_state"]) === 1)
          : undefined;
    const targets: number[] = [];
    if (target) {
      const ordered = direction === "undo" ? [...entries].reverse() : entries;
      let started = false;
      for (const entry of ordered) {
        if (entry === target) started = true;
        if (!started) continue;
        if (entry["action"] !== target["action"] || entry["history_state"] !== target["history_state"]) break;
        targets.push(Number(entry["seq"]));
      }
    }
    return {
      version: Number(row?.["scene_version"] ?? 0),
      targets,
      canUndo: entries.some((entry) => Number(entry["history_state"]) === 0),
      canRedo: entries.some((entry) => Number(entry["history_state"]) === 1),
      target: target ? Number(target["seq"]) : null,
    };
  }

  /** Preview does not mutate storage: the desktop can load every required asset before committing. */
  previewHistory(projectId: string, direction: "undo" | "redo") {
    const state = this.history(projectId, direction);
    if (state.target === null) throw new ConflictError(`Nothing to ${direction}`);
    return { ...state, steps: this.listFrom(this.database.db, projectId, { sequences: state.targets, direction }) };
  }

  commitHistory(projectId: string, direction: "undo" | "redo", version: number, operationId: string): void {
    this.database.transaction((db) => {
      if (
        db
          .prepare("SELECT 1 FROM scene_history_requests WHERE project_id = ? AND operation_id = ?")
          .get(projectId, operationId)
      )
        return;
      const state = this.history(projectId, direction);
      if (state.version !== version || state.target === null)
        throw new ConflictError("Scene history changed; reload before trying again");
      for (const table of ["project_scene_batches", "project_assets"]) {
        for (const seq of state.targets)
          db.prepare(`UPDATE ${table} SET history_state = ? WHERE project_id = ? AND seq = ?`).run(
            direction === "undo" ? 1 : 0,
            projectId,
            seq,
          );
      }
      db.prepare("UPDATE projects SET objects_indexed = 0, scene_version = scene_version + 1 WHERE id = ?").run(
        projectId,
      );
      this.ensureObjectsIndexed(db, projectId);
      db.prepare("INSERT INTO scene_history_requests(project_id, operation_id) VALUES (?, ?)").run(
        projectId,
        operationId,
      );
    });
  }

  private listFrom(
    db: DatabaseSync,
    projectId: string,
    preview?: { sequences: number[]; direction: "undo" | "redo" },
  ): SceneStep[] {
    const sequences = preview?.sequences.join(",") ?? "NULL";
    const active = preview
      ? preview.direction === "undo"
        ? `history_state = 0 AND seq NOT IN (${sequences})`
        : `(history_state = 0 OR (history_state = 1 AND seq IN (${sequences})))`
      : "history_state = 0";
    const commands = db
      .prepare(`SELECT seq, proposal_id, commands_json FROM project_scene_batches WHERE project_id = ? AND ${active}`)
      .all(projectId)
      .map((row): [number, SceneStep] => {
        const parsed: unknown = JSON.parse(textColumn(row, "commands_json"));
        if (!isStoredCommandList(parsed)) throw new Error("A saved scene step is damaged");
        return [
          integerColumn(row, "seq"),
          { kind: "commands", proposalId: textColumn(row, "proposal_id"), commands: parsed },
        ];
      });
    const imports = db
      .prepare(`SELECT seq, id, object_id, name, format FROM project_assets WHERE project_id = ? AND ${active}`)
      .all(projectId)
      .map((row): [number, SceneStep] => [
        integerColumn(row, "seq"),
        {
          kind: "import",
          assetId: textColumn(row, "id"),
          objectId: textColumn(row, "object_id"),
          name: textColumn(row, "name"),
          format: requireOneOf(ASSET_FORMATS, textColumn(row, "format"), "asset format"),
        },
      ]);
    return [...commands, ...imports].sort(([a], [b]) => a - b).map(([, step]) => step);
  }

  /** Gives `target` the same scene as `source`, with its own copies of the imported models. */
  copy(sourceProjectId: string, targetProjectId: string): void {
    this.database.transaction((db) => {
      this.ensureObjectsIndexed(db, sourceProjectId);
      db.prepare(
        `INSERT INTO project_scene_batches (project_id, seq, proposal_id, commands_json, applied_at, action_id)
         SELECT ?, seq, proposal_id, commands_json, applied_at, action_id FROM project_scene_batches WHERE project_id = ? AND history_state = 0`,
      ).run(targetProjectId, sourceProjectId);
      const assets = db
        .prepare("SELECT id FROM project_assets WHERE project_id = ? AND history_state = 0 ORDER BY seq ASC")
        .all(sourceProjectId);
      const insert = db.prepare(
        `INSERT INTO project_assets (id, project_id, seq, object_id, name, format, size, content, created_at)
         SELECT ?, ?, seq, object_id, name, format, size, content, created_at FROM project_assets WHERE id = ?`,
      );
      for (const asset of assets) insert.run(newId("ast"), targetProjectId, textColumn(asset, "id"));
      db.prepare(
        "INSERT INTO project_objects (project_id, object_id) SELECT ?, object_id FROM project_objects WHERE project_id = ?",
      ).run(targetProjectId, sourceProjectId);
      db.prepare("UPDATE projects SET objects_indexed = 1 WHERE id = ?").run(targetProjectId);
    });
  }
}
