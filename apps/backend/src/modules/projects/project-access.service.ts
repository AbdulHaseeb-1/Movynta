import { Injectable } from "@nestjs/common";
import { ForbiddenError } from "../../common/errors/app-error.js";
import { DatabaseService } from "../persistence/database.service.js";
import { textColumn } from "../persistence/row.js";

/**
 * Decides who may use a project id. A stored project belongs to the user who created it. An id that
 * was never created through the projects API is claimed by the first authenticated user to use it,
 * and every later use must come from that owner.
 */
@Injectable()
export class ProjectAccessService {
  constructor(private readonly database: DatabaseService) {}

  assertOwner(userId: string, projectId: string): void {
    const db = this.database.db;
    const stored = db.prepare("SELECT user_id FROM projects WHERE id = ?").get(projectId);
    if (stored) {
      if (textColumn(stored, "user_id") !== userId) throw new ForbiddenError("Project belongs to another user");
      return;
    }
    db.prepare("INSERT OR IGNORE INTO project_owners (project_id, owner_user_id, created_at) VALUES (?, ?, ?)").run(
      projectId,
      userId,
      new Date().toISOString(),
    );
    const row = db.prepare("SELECT owner_user_id FROM project_owners WHERE project_id = ?").get(projectId);
    if (!row || textColumn(row, "owner_user_id") !== userId) {
      throw new ForbiddenError("Project belongs to another user");
    }
  }

  /** True while a run of the project is starting, running or waiting for a decision. */
  hasActiveRun(projectId: string): boolean {
    return this.database.db
      .prepare("SELECT 1 AS active FROM agent_runs WHERE project_id = ? AND status IN ('created', 'running', 'waiting_approval') LIMIT 1")
      .get(projectId) !== undefined;
  }

  /** Marks a stored project as just worked on, so it leads the recent list. Other ids are ignored. */
  recordActivity(projectId: string): void {
    this.database.db
      .prepare("UPDATE projects SET updated_at = ? WHERE id = ?")
      .run(new Date().toISOString(), projectId);
  }
}
