import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { NotFoundError } from "../../common/errors/app-error.js";
import { DatabaseService } from "../persistence/database.service.js";
import { ProjectAccessService } from "../projects/project-access.service.js";
import { SqliteSession } from "./sqlite-session.js";
import { SessionsRepository, type SessionRecord } from "./sessions.repository.js";

/** Sessions are private to the user who created them; other users get 404. */
@Injectable()
export class SessionsService {
  constructor(
    private readonly repository: SessionsRepository,
    private readonly projects: ProjectAccessService,
    private readonly database: DatabaseService,
  ) {}

  create(userId: string, projectId: string): SessionRecord {
    this.projects.assertOwner(userId, projectId);
    const record = { id: randomUUID(), userId, projectId, createdAt: new Date().toISOString() };
    this.repository.insert(record);
    return { ...record, deletedAt: undefined };
  }

  /** Returns the session if it exists, is not deleted, and belongs to `userId`. */
  getOwned(userId: string, sessionId: string): SessionRecord {
    const record = this.repository.find(sessionId);
    if (!record || record.deletedAt !== undefined || record.userId !== userId) {
      throw new NotFoundError("Session not found");
    }
    return record;
  }

  delete(userId: string, sessionId: string): void {
    this.getOwned(userId, sessionId);
    this.repository.markDeleted(sessionId, new Date().toISOString());
  }

  /** Returns the persistent SDK session for an already authorized session id. */
  store(sessionId: string): SqliteSession {
    return new SqliteSession(this.database, sessionId);
  }
}
