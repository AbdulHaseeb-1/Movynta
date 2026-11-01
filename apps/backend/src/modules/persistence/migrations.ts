import type { Migration } from "./persistence.types.js";

/** Append-only schema history. Never edit a shipped migration; add a new version instead. */
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
];
