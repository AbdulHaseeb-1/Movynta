import type { DatabaseSync } from "node:sqlite";
import type { Migration } from "./persistence.types.js";

/** Adds a column unless the table already has it, so a migration can be repeated on a database that got it another way. */
function addColumnIfMissing(db: DatabaseSync, table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (columns.some((existing) => existing["name"] === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

/**
 * Append-only schema history. Never edit a migration that has been applied, even on one machine: a database
 * that already recorded its version skips it, so the change never reaches that database. Add a new version instead.
 */
export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: "initial_schema",
    statements: [
      `CREATE TABLE project_owners (
         project_id TEXT PRIMARY KEY,
         owner_user_id TEXT NOT NULL,
         created_at TEXT NOT NULL
       )`,
      `CREATE TABLE sessions (
         id TEXT PRIMARY KEY,
         user_id TEXT NOT NULL,
         project_id TEXT NOT NULL,
         created_at TEXT NOT NULL,
         deleted_at TEXT
       )`,
      `CREATE INDEX sessions_user_idx ON sessions (user_id)`,
      `CREATE TABLE session_items (
         session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
         seq INTEGER NOT NULL,
         item_json TEXT NOT NULL,
         PRIMARY KEY (session_id, seq)
       )`,
      `CREATE TABLE agent_runs (
         id TEXT PRIMARY KEY,
         session_id TEXT NOT NULL REFERENCES sessions (id),
         user_id TEXT NOT NULL,
         project_id TEXT NOT NULL,
         agent_id TEXT NOT NULL,
         editor_client_id TEXT,
         status TEXT NOT NULL,
         input TEXT NOT NULL,
         final_output TEXT,
         error_code TEXT,
         error_message TEXT,
         usage_json TEXT,
         run_state TEXT,
         created_at TEXT NOT NULL,
         updated_at TEXT NOT NULL
       )`,
      `CREATE INDEX agent_runs_user_idx ON agent_runs (user_id)`,
      `CREATE TABLE agent_run_events (
         run_id TEXT NOT NULL REFERENCES agent_runs (id) ON DELETE CASCADE,
         seq INTEGER NOT NULL,
         event_id TEXT NOT NULL UNIQUE,
         type TEXT NOT NULL,
         timestamp TEXT NOT NULL,
         payload_json TEXT NOT NULL,
         PRIMARY KEY (run_id, seq)
       )`,
      `CREATE TABLE approvals (
         id TEXT PRIMARY KEY,
         run_id TEXT NOT NULL REFERENCES agent_runs (id) ON DELETE CASCADE,
         user_id TEXT NOT NULL,
         call_id TEXT NOT NULL,
         tool_name TEXT NOT NULL,
         status TEXT NOT NULL,
         preview_json TEXT NOT NULL,
         reason TEXT,
         created_at TEXT NOT NULL,
         expires_at TEXT NOT NULL,
         decided_at TEXT
       )`,
      `CREATE INDEX approvals_run_idx ON approvals (run_id)`,
      `CREATE TABLE editor_proposals (
         id TEXT PRIMARY KEY,
         run_id TEXT NOT NULL REFERENCES agent_runs (id) ON DELETE CASCADE,
         project_id TEXT NOT NULL,
         client_id TEXT NOT NULL,
         base_revision INTEGER NOT NULL,
         summary TEXT NOT NULL,
         commands_json TEXT NOT NULL,
         requires_approval INTEGER NOT NULL,
         status TEXT NOT NULL,
         result_json TEXT,
         created_at TEXT NOT NULL,
         updated_at TEXT NOT NULL
       )`,
    ],
  },
  {
    version: 2,
    name: "run_request_context",
    statements: [
      `ALTER TABLE agent_runs ADD COLUMN dimension TEXT`,
      `ALTER TABLE agent_runs ADD COLUMN selected_skill_ids_json TEXT NOT NULL DEFAULT '[]'`,
    ],
  },
  {
    version: 3,
    name: "model_providers",
    statements: [
      `CREATE TABLE model_providers (user_id TEXT NOT NULL, provider_id TEXT NOT NULL, model TEXT NOT NULL, encrypted_key TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, provider_id))`,
      `ALTER TABLE agent_runs ADD COLUMN provider_id TEXT`,
      `ALTER TABLE agent_runs ADD COLUMN provider_model TEXT`,
    ],
  },
  {
    version: 4,
    name: "compatible_provider_endpoints",
    statements: [
      `ALTER TABLE model_providers ADD COLUMN base_url TEXT`,
      `ALTER TABLE agent_runs ADD COLUMN provider_base_url TEXT`,
    ],
  },
  {
    version: 5,
    name: "run_reasoning_effort",
    statements: [`ALTER TABLE agent_runs ADD COLUMN reasoning_effort TEXT`],
  },
  {
    version: 6,
    name: "chatgpt_subscription_logins",
    statements: [
      `CREATE TABLE chatgpt_logins (
         user_id TEXT PRIMARY KEY,
         encrypted_tokens TEXT NOT NULL,
         email TEXT,
         plan TEXT,
         connected_at TEXT NOT NULL,
         expires_at TEXT NOT NULL
       )`,
    ],
  },
  {
    version: 7,
    name: "projects",
    statements: [
      `CREATE TABLE projects (
         id TEXT PRIMARY KEY,
         user_id TEXT NOT NULL,
         name TEXT NOT NULL DEFAULT '',
         category TEXT NOT NULL,
         starred INTEGER NOT NULL DEFAULT 0,
         archived_at TEXT,
         created_at TEXT NOT NULL,
         updated_at TEXT NOT NULL
       )`,
      `CREATE INDEX projects_user_idx ON projects (user_id, updated_at DESC)`,
      `CREATE TABLE project_scene_batches (
         project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
         seq INTEGER NOT NULL,
         proposal_id TEXT NOT NULL,
         commands_json TEXT NOT NULL,
         applied_at TEXT NOT NULL,
         PRIMARY KEY (project_id, seq)
       )`,
    ],
  },
  {
    version: 8,
    name: "project_assets",
    statements: [
      // Imported models share the numbering of scene batches, so a replay keeps the order things happened in.
      `CREATE TABLE project_assets (
         id TEXT PRIMARY KEY,
         project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
         seq INTEGER NOT NULL,
         object_id TEXT NOT NULL,
         name TEXT NOT NULL,
         format TEXT NOT NULL,
         size INTEGER NOT NULL,
         content BLOB NOT NULL,
         created_at TEXT NOT NULL,
         UNIQUE (project_id, seq)
       )`,
    ],
  },
  {
    version: 9,
    name: "project_lookup_indexes",
    statements: [
      // Listing projects counts and reads the first run of each one; without these every project scans every run.
      `CREATE INDEX agent_runs_project_idx ON agent_runs (project_id, created_at)`,
      `CREATE INDEX agent_runs_session_idx ON agent_runs (session_id, created_at)`,
      `CREATE INDEX sessions_project_idx ON sessions (project_id)`,
      `CREATE INDEX editor_proposals_project_idx ON editor_proposals (project_id)`,
      // The objects a project currently holds, kept up to date as its history grows, so checking that an
      // object exists never has to replay the history. Older projects are indexed the first time they are used.
      `ALTER TABLE projects ADD COLUMN objects_indexed INTEGER NOT NULL DEFAULT 0`,
      `CREATE TABLE project_objects (
         project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
         object_id TEXT NOT NULL,
         PRIMARY KEY (project_id, object_id)
       ) WITHOUT ROWID`,
    ],
  },
  {
    version: 10,
    name: "revision_bound_proposals",
    statements: [`ALTER TABLE editor_proposals ADD COLUMN strict_revision INTEGER NOT NULL DEFAULT 0`],
  },
  {
    version: 11,
    name: "scene_undo_history",
    statements: [
      `ALTER TABLE project_scene_batches ADD COLUMN history_state INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE project_assets ADD COLUMN history_state INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE projects ADD COLUMN scene_version INTEGER NOT NULL DEFAULT 0`,
      `CREATE TABLE scene_history_requests (project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, operation_id TEXT NOT NULL, PRIMARY KEY(project_id, operation_id))`,
    ],
  },
  {
    version: 12,
    name: "manual_history_actions",
    statements: [`ALTER TABLE project_scene_batches ADD COLUMN action_id TEXT`],
  },
  {
    // This column was first added to version 11 after that version had already run on existing databases, which
    // then skipped it. It is a version of its own now, and skips itself on a database that did get the column.
    version: 13,
    name: "proposal_delivery_pending",
    statements: [],
    run: (db) => addColumnIfMissing(db, "editor_proposals", "delivery_pending", "INTEGER NOT NULL DEFAULT 0"),
  },
  {
    version: 14,
    name: "project_measurements",
    statements: [],
    run: (db) => {
      addColumnIfMissing(
        db,
        "projects",
        "measurements_json",
        'TEXT NOT NULL DEFAULT \'{"units":null,"annotations":[]}\'',
      );
      addColumnIfMissing(db, "projects", "measurements_version", "INTEGER NOT NULL DEFAULT 0");
    },
  },
  {
    // Plans and unfinished work survive an approval pause. Pictures can be switched off for a compatible provider
    // whose model cannot read them; every existing provider keeps sending them.
    version: 15,
    name: "run_progress_and_picture_setting",
    statements: [
      `ALTER TABLE agent_runs ADD COLUMN progress_json TEXT`,
      `ALTER TABLE model_providers ADD COLUMN accepts_images INTEGER NOT NULL DEFAULT 1`,
    ],
  },
  {
    // The pictures a user attached to a request: only their names, types and sizes. The pixels are sent to the
    // model with the request and are never stored.
    version: 16,
    name: "run_attachments",
    statements: [],
    run: (db) => addColumnIfMissing(db, "agent_runs", "attachments_json", "TEXT"),
  },
  {
    // What each tool call of a run returned, kept whole so its step can be opened later. The run events carry only
    // the id. Removing a run removes its outputs.
    version: 17,
    name: "agent_tool_outputs",
    statements: [
      `CREATE TABLE agent_tool_outputs (
         id TEXT PRIMARY KEY,
         run_id TEXT NOT NULL REFERENCES agent_runs (id) ON DELETE CASCADE,
         tool_name TEXT NOT NULL,
         input_json TEXT NOT NULL,
         output_text TEXT NOT NULL,
         output_bytes INTEGER NOT NULL,
         truncated INTEGER NOT NULL DEFAULT 0,
         created_at TEXT NOT NULL
       )`,
      "CREATE INDEX agent_tool_outputs_run ON agent_tool_outputs (run_id)",
    ],
  },
];
