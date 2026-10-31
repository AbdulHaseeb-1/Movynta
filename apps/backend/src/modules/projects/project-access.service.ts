import { Injectable } from "@nestjs/common";
import { ForbiddenError } from "../../common/errors/app-error.js";
import { DatabaseService } from "../persistence/database.service.js";
import { textColumn } from "../persistence/row.js";

/**
 * Projects are identified by client-supplied ids. The first authenticated user to
 * use a project id becomes its owner; every later use must come from that owner.
 */
@Injectable()
export class ProjectAccessService {
  constructor(private readonly database: DatabaseService) {}

  assertOwner(userId: string, projectId: string): void {
    const db = this.database.db;
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
}
