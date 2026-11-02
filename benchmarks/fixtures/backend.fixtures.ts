import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { loadAppConfig } from "../../apps/backend/src/config/configuration";
import { DatabaseService } from "../../apps/backend/src/modules/persistence/database.service";
import { ProjectScenesService } from "../../apps/backend/src/modules/projects/project-scenes.service";
import { benchConfig } from "../config/bench.config";
import { boxCommand, MAX_COMMANDS_PER_BATCH, moveCommand, seededRandom } from "./scene.fixtures";

export const BENCH_USER = "bench-user";

/** A migrated in-memory database, like the one the backend tests use. */
export function openDatabase(): DatabaseService {
  const config = loadAppConfig({
    NODE_ENV: "test",
    AUTH_SECRET: "benchmark-secret-benchmark-secret-12345",
    DATABASE_URL: ":memory:",
    AGENTS_ENABLED: "false",
  });
  const database = new DatabaseService(config);
  database.open(":memory:");
  return database;
}

export function insertProject(database: DatabaseService, id: string, name = "", updatedAt = new Date().toISOString()) {
  database.db
    .prepare(
      "INSERT INTO projects (id, user_id, name, category, starred, created_at, updated_at) VALUES (?, ?, ?, 'design', 0, ?, ?)",
    )
    .run(id, BENCH_USER, name, updatedAt, updatedAt);
}

/** Records a finished request in a project, as a run would, so listings and searches have something to read. */
export function insertRun(database: DatabaseService, projectId: string, input: string, createdAt: string) {
  const sessionId = randomUUID();
  database.db
    .prepare("INSERT INTO sessions (id, user_id, project_id, created_at) VALUES (?, ?, ?, ?)")
    .run(sessionId, BENCH_USER, projectId, createdAt);
  database.db
    .prepare(
      "INSERT INTO agent_runs (id, session_id, user_id, project_id, agent_id, status, input, final_output, created_at, updated_at) VALUES (?, ?, ?, ?, 'modeling-coordinator', 'completed', ?, 'Done.', ?, ?)",
    )
    .run(`run_${randomUUID()}`, sessionId, BENCH_USER, projectId, input, createdAt, createdAt);
}

/** `projects` projects with `runsPerProject` runs each, all in one transaction. */
export function seedProjects(database: DatabaseService, projects: number, runsPerProject: number) {
  const random = seededRandom();
  database.transaction(() => {
    for (let project = 0; project < projects; project += 1) {
      const id = `prj_${String(project).padStart(8, "0")}-0000-0000-0000-000000000000`;
      const at = new Date(Date.now() - project * 60_000).toISOString();
      insertProject(database, id, random() > 0.5 ? `Project ${project}` : "", at);
      for (let run = 0; run < runsPerProject; run += 1)
        insertRun(database, id, `Make object ${project}-${run} with some words to search`, at);
    }
  });
}

export interface SeededHistory {
  projectId: string;
  scenes: ProjectScenesService;
}

/**
 * A project whose scene history has `objects` boxes (created in batches of up to 50) followed by
 * transform edits until the history holds `steps` steps, like a project that has been worked on for a while.
 */
export function seedHistory(database: DatabaseService, steps: number, objects = 100): SeededHistory {
  const projectId = `prj_history-${steps}-${objects}`;
  insertProject(database, projectId, "History");
  const scenes = new ProjectScenesService(database);
  const random = seededRandom(benchConfig.seed + steps);
  let recorded = 0;
  for (let start = 0; start < objects && recorded < steps; start += MAX_COMMANDS_PER_BATCH) {
    const batch = [];
    for (let index = start; index < Math.min(objects, start + MAX_COMMANDS_PER_BATCH); index += 1)
      batch.push(boxCommand(index));
    scenes.append(projectId, `seed-${recorded}`, batch as never);
    recorded += 1;
  }
  while (recorded < steps) {
    scenes.append(projectId, `usr_seed-${recorded}`, [moveCommand(`obj_${Math.floor(random() * objects)}`, random() * 10)] as never);
    recorded += 1;
  }
  return { projectId, scenes };
}
