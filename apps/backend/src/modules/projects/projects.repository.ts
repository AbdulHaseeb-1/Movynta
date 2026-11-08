import { Injectable } from "@nestjs/common";
import { projectMeasurementsSchema, type ProjectMeasurements } from "@movynta/editor-protocol";
import { DatabaseService } from "../persistence/database.service.js";
import type { SqlRow } from "../persistence/persistence.types.js";
import { integerColumn, optionalTextColumn, textColumn } from "../persistence/row.js";
import { requireOneOf } from "../../shared/guards/enum.guard.js";
import { parseAttachmentSummaries } from "../../shared/schemas/attachments.schema.js";
import {
  PROJECT_CATEGORIES,
  type ProjectConversation,
  type ProjectConversationProvider,
  type ProjectListQuery,
  type ProjectMessage,
  type ProjectMessageStatus,
  type ProjectRecord,
  type ProjectSort,
  type ProjectView,
} from "./projects.types.js";

const RUN_STATUSES: readonly ProjectMessageStatus[] = [
  "created",
  "running",
  "waiting_approval",
  "completed",
  "failed",
  "cancelled",
];
const PROMPT_PREVIEW_LENGTH = 140;

const ORDER_BY: Readonly<Record<ProjectSort, string>> = {
  updated: "p.updated_at DESC",
  created: "p.created_at DESC",
  name: "(p.name = '') ASC, p.name COLLATE NOCASE ASC, p.updated_at DESC",
};

function toRecord(row: SqlRow): ProjectRecord {
  return {
    id: textColumn(row, "id"),
    userId: textColumn(row, "user_id"),
    name: textColumn(row, "name"),
    category: requireOneOf(PROJECT_CATEGORIES, textColumn(row, "category"), "project category"),
    starred: integerColumn(row, "starred") === 1,
    archivedAt: optionalTextColumn(row, "archived_at"),
    createdAt: textColumn(row, "created_at"),
    updatedAt: textColumn(row, "updated_at"),
  };
}

function toView(row: SqlRow): ProjectView {
  const record = toRecord(row);
  const prompt = optionalTextColumn(row, "first_prompt") ?? "";
  return {
    id: record.id,
    name: record.name,
    category: record.category,
    starred: record.starred,
    archived: record.archivedAt !== undefined,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    runCount: integerColumn(row, "run_count"),
    firstPrompt:
      prompt.length > PROMPT_PREVIEW_LENGTH ? `${prompt.slice(0, PROMPT_PREVIEW_LENGTH).trimEnd()}…` : prompt,
  };
}

/** Escapes LIKE wildcards so a search for "50%" matches that text instead of everything. */
function likePattern(search: string): string {
  return `%${search.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

const SELECT_VIEW = `
  SELECT p.*,
    (SELECT COUNT(*) FROM agent_runs r JOIN sessions s ON s.id = r.session_id WHERE r.project_id = p.id AND s.deleted_at IS NULL) AS run_count,
    (SELECT r.input FROM agent_runs r JOIN sessions s ON s.id = r.session_id WHERE r.project_id = p.id AND s.deleted_at IS NULL ORDER BY r.created_at ASC LIMIT 1) AS first_prompt
  FROM projects p`;

/** SQL for projects and the data that belongs to them. Authorization lives in the service. */
@Injectable()
export class ProjectsRepository {
  constructor(private readonly database: DatabaseService) {}

  measurements(projectId: string) {
    const row = this.database.db
      .prepare("SELECT measurements_json, measurements_version FROM projects WHERE id = ?")
      .get(projectId);
    if (!row) throw new Error("Project does not exist");
    return {
      version: integerColumn(row, "measurements_version"),
      value: projectMeasurementsSchema.parse(JSON.parse(textColumn(row, "measurements_json"))),
    };
  }

  saveMeasurements(projectId: string, version: number, value: ProjectMeasurements): boolean {
    return (
      this.database.db
        .prepare(
          "UPDATE projects SET measurements_json = ?, measurements_version = measurements_version + 1 WHERE id = ? AND measurements_version = ?",
        )
        .run(JSON.stringify(value), projectId, version).changes === 1
    );
  }

  insert(project: Omit<ProjectRecord, "archivedAt" | "starred">): void {
    this.database.db
      .prepare(
        "INSERT INTO projects (id, user_id, name, category, starred, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)",
      )
      .run(project.id, project.userId, project.name, project.category, project.createdAt, project.updatedAt);
  }

  find(projectId: string): ProjectRecord | undefined {
    const row = this.database.db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId);
    return row ? toRecord(row) : undefined;
  }

  view(projectId: string): ProjectView | undefined {
    const row = this.database.db.prepare(`${SELECT_VIEW} WHERE p.id = ?`).get(projectId);
    return row ? toView(row) : undefined;
  }

  list(userId: string, query: ProjectListQuery): ProjectView[] {
    const clauses = ["p.user_id = ?"];
    const values: (string | number)[] = [userId];
    if (query.scope === "active") clauses.push("p.archived_at IS NULL");
    if (query.scope === "archived") clauses.push("p.archived_at IS NOT NULL");
    if (query.category) {
      clauses.push("p.category = ?");
      values.push(query.category);
    }
    if (query.starredOnly) clauses.push("p.starred = 1");
    if (query.search) {
      const pattern = likePattern(query.search);
      clauses.push(
        `(p.name LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM agent_runs r WHERE r.project_id = p.id AND r.input LIKE ? ESCAPE '\\'))`,
      );
      values.push(pattern, pattern);
    }
    return this.database.db
      .prepare(`${SELECT_VIEW} WHERE ${clauses.join(" AND ")} ORDER BY ${ORDER_BY[query.sort]}`)
      .all(...values)
      .map(toView);
  }

  /**
   * Applies a partial update. `touch` bumps `updated_at`: renaming counts as work on the project,
   * but starring or archiving is only organizing, so it must not reorder the recent list.
   */
  update(
    projectId: string,
    patch: { name?: string; starred?: boolean; archivedAt?: string | null },
    now: string,
    touch: boolean,
  ): void {
    const assignments: string[] = [];
    const values: (string | number | null)[] = [];
    if (patch.name !== undefined) {
      assignments.push("name = ?");
      values.push(patch.name);
    }
    if (patch.starred !== undefined) {
      assignments.push("starred = ?");
      values.push(patch.starred ? 1 : 0);
    }
    if (patch.archivedAt !== undefined) {
      assignments.push("archived_at = ?");
      values.push(patch.archivedAt);
    }
    if (touch) {
      assignments.push("updated_at = ?");
      values.push(now);
    }
    if (assignments.length === 0) return;
    this.database.db.prepare(`UPDATE projects SET ${assignments.join(", ")} WHERE id = ?`).run(...values, projectId);
  }

  touch(projectId: string, now: string): void {
    this.database.db.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(now, projectId);
  }

  hasActiveRun(projectId: string): boolean {
    return (
      this.database.db
        .prepare(
          "SELECT 1 AS active FROM agent_runs WHERE project_id = ? AND status IN ('created', 'running', 'waiting_approval') LIMIT 1",
        )
        .get(projectId) !== undefined
    );
  }

  /** The chat of the latest session in the project, oldest request first. */
  conversation(projectId: string): ProjectConversation {
    const latest = this.database.db
      .prepare(
        "SELECT r.session_id, r.provider_id, r.provider_model, r.provider_base_url FROM agent_runs r JOIN sessions s ON s.id = r.session_id WHERE r.project_id = ? AND s.deleted_at IS NULL ORDER BY r.created_at DESC LIMIT 1",
      )
      .get(projectId);
    if (!latest) return { sessionId: undefined, provider: undefined, messages: [] };
    const sessionId = textColumn(latest, "session_id");
    const providerId = optionalTextColumn(latest, "provider_id");
    const provider: ProjectConversationProvider | undefined =
      providerId === undefined
        ? undefined
        : {
            id: providerId,
            model: optionalTextColumn(latest, "provider_model") ?? "",
            baseUrl: optionalTextColumn(latest, "provider_base_url") ?? "",
          };
    const messages = this.database.db
      .prepare(
        "SELECT id, input, final_output, status, error_message, created_at, attachments_json FROM agent_runs WHERE session_id = ? ORDER BY created_at ASC",
      )
      .all(sessionId)
      .map(
        (row): ProjectMessage => ({
          runId: textColumn(row, "id"),
          prompt: textColumn(row, "input"),
          reply: optionalTextColumn(row, "final_output"),
          attachments: parseAttachmentSummaries(optionalTextColumn(row, "attachments_json")),
          status: requireOneOf(RUN_STATUSES, textColumn(row, "status"), "run status"),
          error: optionalTextColumn(row, "error_message"),
          createdAt: textColumn(row, "created_at"),
        }),
      );
    return { sessionId, provider, messages };
  }

  /** Clears every chat session for a project, without deleting the runs and proposals needed by scene history. */
  clearConversation(projectId: string, now: string): void {
    this.database.transaction((db) => {
      db.prepare("DELETE FROM session_items WHERE session_id IN (SELECT id FROM sessions WHERE project_id = ?)").run(
        projectId,
      );
      db.prepare("UPDATE sessions SET deleted_at = COALESCE(deleted_at, ?) WHERE project_id = ?").run(now, projectId);
      db.prepare("DELETE FROM agent_run_events WHERE run_id IN (SELECT id FROM agent_runs WHERE project_id = ?)").run(
        projectId,
      );
      db.prepare(
        "UPDATE agent_runs SET input = '', final_output = NULL, error_message = NULL, run_state = NULL WHERE project_id = ?",
      ).run(projectId);
    });
  }

  /** Removes the project with its chats, runs and scene. Deleting a run cascades to its events, approvals and proposals. */
  purge(projectId: string): void {
    this.database.transaction((db) => {
      db.prepare("DELETE FROM agent_runs WHERE project_id = ?").run(projectId);
      db.prepare("DELETE FROM sessions WHERE project_id = ?").run(projectId);
      db.prepare("DELETE FROM editor_proposals WHERE project_id = ?").run(projectId);
      db.prepare("DELETE FROM project_owners WHERE project_id = ?").run(projectId);
      db.prepare("DELETE FROM projects WHERE id = ?").run(projectId);
    });
  }
}
