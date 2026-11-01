import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { APP_CONFIG } from "../../config/config.module.js";
import { MEMORY_DATABASE } from "../../config/configuration.js";
import type { AppConfig } from "../../config/config.types.js";
import { MIGRATIONS } from "./migrations.js";

/**
 * Owns the SQLite connection (built-in `node:sqlite`) and applies migrations on
 * startup. Repositories receive this service and use its connection.
 */
@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private connection: DatabaseSync | undefined;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  onModuleInit(): void {
    this.open(this.config.database.path);
  }

  onModuleDestroy(): void {
    this.close();
  }

  /** Opens a database at `path` (or `:memory:`) and migrates it. Used by tests directly. */
  open(path: string): void {
    if (this.connection) return;
    if (path !== MEMORY_DATABASE) mkdirSync(dirname(path), { recursive: true });

    const db = new DatabaseSync(path);
    db.exec("PRAGMA foreign_keys = ON");
    if (path !== MEMORY_DATABASE) db.exec("PRAGMA journal_mode = WAL");
    this.connection = db;
    this.migrate(db);
    this.logger.log(`database ready (${path === MEMORY_DATABASE ? "in-memory" : path})`);
  }

  get db(): DatabaseSync {
    if (!this.connection) throw new Error("Database is not open");
    return this.connection;
  }

  /** Runs `work` inside a transaction, rolling back on any thrown error. */
  transaction<T>(work: (db: DatabaseSync) => T): T {
    const db = this.db;
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = work(db);
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  ping(): boolean {
    return this.db.prepare("SELECT 1 AS ok").get() !== undefined;
  }

  close(): void {
    this.connection?.close();
    this.connection = undefined;
  }

  private migrate(db: DatabaseSync): void {
    db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )`);
    const applied = new Set(
      db.prepare("SELECT version FROM schema_migrations").all().map((row) => Number(row["version"])),
    );

    for (const migration of MIGRATIONS) {
      if (applied.has(migration.version)) continue;
      db.exec("BEGIN IMMEDIATE");
      try {
        for (const statement of migration.statements) db.exec(statement);
        db.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)").run(
          migration.version,
          migration.name,
          new Date().toISOString(),
        );
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    }
  }
}
