import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { loadAppConfig } from "../../config/configuration.js";
import { TEST_AUTH_SECRET } from "../../testing/constants.js";
import { DatabaseService } from "./database.service.js";
import { MIGRATIONS } from "./migrations.js";

const folders: string[] = [];

afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

function newDatabaseService(): DatabaseService {
  return new DatabaseService(
    loadAppConfig({ NODE_ENV: "test", AUTH_SECRET: TEST_AUTH_SECRET, DATABASE_URL: ":memory:", AGENTS_ENABLED: "false" }),
  );
}

/** A database file as an older build left it: only the migrations up to `lastVersion` have run. */
function databaseAt(lastVersion: number): string {
  const folder = mkdtempSync(join(tmpdir(), "movynta-migrations-"));
  folders.push(folder);
  const path = join(folder, "movynta.sqlite");
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)");
  for (const migration of MIGRATIONS.filter((item) => item.version <= lastVersion)) {
    for (const statement of migration.statements) db.exec(statement);
    migration.run?.(db);
    db.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)").run(
      migration.version,
      migration.name,
      new Date().toISOString(),
    );
  }
  db.close();
  return path;
}

function columnsOf(service: DatabaseService, table: string): string[] {
  return service.db.prepare(`PRAGMA table_info(${table})`).all().map((column) => String(column["name"]));
}

function appliedVersions(service: DatabaseService): number[] {
  return service.db
    .prepare("SELECT version FROM schema_migrations ORDER BY version")
    .all()
    .map((row) => Number(row["version"]));
}

describe("schema migrations", () => {
  it("adds measurement storage to a database at version 13", () => {
    const service = newDatabaseService();
    service.open(databaseAt(13));
    expect(columnsOf(service, "projects")).toContain("measurements_json");
    expect(columnsOf(service, "projects")).toContain("measurements_version");
    expect(appliedVersions(service)).toContain(14);
    service.close();
  });
  it("lists each version once, in order", () => {
    const versions = MIGRATIONS.map((migration) => migration.version);
    expect(versions).toEqual(versions.map((_, index) => index + 1));
  });

  it("gives a new database every column exactly once", () => {
    const service = newDatabaseService();
    service.open(":memory:");

    const columns = columnsOf(service, "editor_proposals");
    expect(columns).toContain("delivery_pending");
    expect(new Set(columns).size).toBe(columns.length);
    expect(appliedVersions(service)).toEqual(MIGRATIONS.map((migration) => migration.version));
    service.close();
  });

  it("adds the delivery flag to a database that had already run migrations 11 and 12 without it", () => {
    // The state of a database that was migrated before the flag existed: it never reran version 11.
    const path = databaseAt(12);
    const before = new DatabaseSync(path, { readOnly: true });
    expect(before.prepare("PRAGMA table_info(editor_proposals)").all().map((column) => column["name"])).not.toContain("delivery_pending");
    before.close();

    const service = newDatabaseService();
    service.open(path);

    expect(columnsOf(service, "editor_proposals")).toContain("delivery_pending");
    expect(appliedVersions(service)).toContain(13);
    // The queries the app runs against the column work, and a proposal that was stored before it counts as delivered.
    expect(service.db.prepare("SELECT 1 FROM editor_proposals WHERE project_id = ? AND delivery_pending = 1 LIMIT 1").get("project")).toBeUndefined();
    service.close();
  });

  it("leaves a database alone that already has the flag, however it got it", () => {
    const path = databaseAt(12);
    const raw = new DatabaseSync(path);
    raw.exec("ALTER TABLE editor_proposals ADD COLUMN delivery_pending INTEGER NOT NULL DEFAULT 0");
    raw.close();

    const service = newDatabaseService();
    expect(() => service.open(path)).not.toThrow();

    const columns = columnsOf(service, "editor_proposals");
    expect(columns.filter((name) => name === "delivery_pending")).toHaveLength(1);
    expect(appliedVersions(service)).toContain(13);
    service.close();
  });

  it("keeps stored proposals and reads them with the flag off", () => {
    const path = databaseAt(12);
    const raw = new DatabaseSync(path);
    raw.exec("PRAGMA foreign_keys = OFF");
    raw.prepare(
      `INSERT INTO editor_proposals (id, run_id, project_id, client_id, base_revision, summary, commands_json, requires_approval, status, created_at, updated_at)
       VALUES ('prp_old', 'run_1', 'proj-1', 'client-1', 4, 'Old proposal', '[]', 0, 'applied', 't', 't')`,
    ).run();
    raw.close();

    const service = newDatabaseService();
    service.open(path);

    const row = service.db.prepare("SELECT delivery_pending FROM editor_proposals WHERE id = 'prp_old'").get();
    expect(row?.["delivery_pending"]).toBe(0);
    service.close();
  });
});
