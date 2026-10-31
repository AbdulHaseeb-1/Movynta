import { Injectable } from "@nestjs/common";
import { z } from "zod";
import { DatabaseService } from "../persistence/database.service.js";
import { integerColumn, optionalTextColumn, textColumn, type SqlRow } from "../persistence/row.js";
import { MODELING_DIMENSIONS, type ModelingDimension } from "../../shared/schemas/modeling-plan.schema.js";
import { requireOneOf } from "../../shared/guards/enum.guard.js";
import { NotFoundError } from "../../common/errors/app-error.js";
import { AGENT_RUN_STATUSES, transitionRun, type AgentRunStatus } from "./agent-run.state-machine.js";
import { AGENT_RUN_EVENT_TYPES, type AgentRunEvent, type AgentRunEventType } from "./agent-run.events.js";
import { parseEventPayload } from "./agent-run-event-payload.schema.js";

export interface AgentRunRecord {
  readonly id: string;
  readonly sessionId: string;
  readonly userId: string;
  readonly projectId: string;
  readonly agentId: string;
  readonly editorClientId: string | undefined;
  readonly dimension: ModelingDimension | undefined;
  readonly selectedSkillIds: readonly string[];
  readonly status: AgentRunStatus;
  readonly input: string;
  readonly finalOutput: string | undefined;
  readonly errorCode: string | undefined;
  readonly errorMessage: string | undefined;
  readonly usage: Readonly<Record<string, number>> | undefined;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface NewAgentRun {
  readonly id: string;
  readonly sessionId: string;
  readonly userId: string;
  readonly projectId: string;
  readonly agentId: string;
  readonly editorClientId: string | undefined;
  readonly dimension: ModelingDimension | undefined;
  readonly selectedSkillIds: readonly string[];
  readonly input: string;
  readonly now: string;
}

export interface RunUpdate {
  readonly status?: AgentRunStatus;
  readonly finalOutput?: string;
  readonly errorCode?: string;
  readonly errorMessage?: string;
  readonly usage?: Readonly<Record<string, number>>;
  readonly runState?: string | null;
}

const usageSchema = z.record(z.string(), z.number());
const skillIdsSchema = z.array(z.string());

function toRecord(row: SqlRow): AgentRunRecord {
  const usageJson = optionalTextColumn(row, "usage_json");
  const dimension = optionalTextColumn(row, "dimension");
  return {
    id: textColumn(row, "id"),
    sessionId: textColumn(row, "session_id"),
    userId: textColumn(row, "user_id"),
    projectId: textColumn(row, "project_id"),
    agentId: textColumn(row, "agent_id"),
    editorClientId: optionalTextColumn(row, "editor_client_id"),
    dimension: dimension === undefined ? undefined : requireOneOf(MODELING_DIMENSIONS, dimension, "dimension"),
    selectedSkillIds: skillIdsSchema.parse(JSON.parse(textColumn(row, "selected_skill_ids_json"))),
    status: requireOneOf(AGENT_RUN_STATUSES, textColumn(row, "status"), "run status"),
    input: textColumn(row, "input"),
    finalOutput: optionalTextColumn(row, "final_output"),
    errorCode: optionalTextColumn(row, "error_code"),
    errorMessage: optionalTextColumn(row, "error_message"),
    usage: usageJson === undefined ? undefined : usageSchema.parse(JSON.parse(usageJson)),
    createdAt: textColumn(row, "created_at"),
    updatedAt: textColumn(row, "updated_at"),
  };
}

/** Persistence for runs and their event logs. `run_state` is server-side only. */
@Injectable()
export class AgentRunRepository {
  constructor(private readonly database: DatabaseService) {}

  insert(run: NewAgentRun): void {
    this.database
      .db.prepare(
        `INSERT INTO agent_runs (id, session_id, user_id, project_id, agent_id, editor_client_id, dimension, selected_skill_ids_json, status, input, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'created', ?, ?, ?)`,
      )
      .run(
        run.id,
        run.sessionId,
        run.userId,
        run.projectId,
        run.agentId,
        run.editorClientId ?? null,
        run.dimension ?? null,
        JSON.stringify(run.selectedSkillIds),
        run.input,
        run.now,
        run.now,
      );
  }

  find(runId: string): AgentRunRecord | undefined {
    const row = this.database.db.prepare("SELECT * FROM agent_runs WHERE id = ?").get(runId);
    return row ? toRecord(row) : undefined;
  }

  /** Moves a run to `to` after validating the transition, then applies the update. */
  transition(runId: string, to: AgentRunStatus, update: RunUpdate, now: string): void {
    const current = this.find(runId);
    if (!current) throw new NotFoundError("Agent run not found");
    transitionRun(current.status, to);
    this.update(runId, { ...update, status: to }, now);
  }

  /** Applies a partial update and bumps `updated_at`. */
  update(runId: string, update: RunUpdate, now: string): void {
    const assignments: string[] = ["updated_at = ?"];
    const values: (string | number | null)[] = [now];
    if (update.status !== undefined) {
      assignments.push("status = ?");
      values.push(update.status);
    }
    if (update.finalOutput !== undefined) {
      assignments.push("final_output = ?");
      values.push(update.finalOutput);
    }
    if (update.errorCode !== undefined) {
      assignments.push("error_code = ?");
      values.push(update.errorCode);
    }
    if (update.errorMessage !== undefined) {
      assignments.push("error_message = ?");
      values.push(update.errorMessage);
    }
    if (update.usage !== undefined) {
      assignments.push("usage_json = ?");
      values.push(JSON.stringify(update.usage));
    }
    if (update.runState !== undefined) {
      assignments.push("run_state = ?");
      values.push(update.runState);
    }
    values.push(runId);
    this.database.db.prepare(`UPDATE agent_runs SET ${assignments.join(", ")} WHERE id = ?`).run(...values);
  }

  /** Stores the serialized SDK run state. Read only by the server when resuming. */
  readRunState(runId: string): string | undefined {
    const row = this.database.db.prepare("SELECT run_state FROM agent_runs WHERE id = ?").get(runId);
    return row ? optionalTextColumn(row, "run_state") : undefined;
  }

  listRunningOrWaiting(): AgentRunRecord[] {
    return this.database.db
      .prepare("SELECT * FROM agent_runs WHERE status IN ('created', 'running')")
      .all()
      .map(toRecord);
  }

  /** Appends one event with the next sequence number, inside the caller's transaction. */
  appendEvent(
    runId: string,
    eventId: string,
    type: AgentRunEventType,
    timestamp: string,
    payloadJson: string,
  ): AgentRunEvent {
    return this.database.transaction((db) => {
      const current = db.prepare("SELECT COALESCE(MAX(seq), 0) AS max_seq FROM agent_run_events WHERE run_id = ?").get(runId);
      if (!current) throw new Error("Failed to read event sequence");
      const seq = integerColumn(current, "max_seq") + 1;
      db.prepare(
        "INSERT INTO agent_run_events (run_id, seq, event_id, type, timestamp, payload_json) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(runId, seq, eventId, type, timestamp, payloadJson);
      return { id: eventId, runId, seq, type, timestamp, payload: parseEventPayload(type, JSON.parse(payloadJson)) };
    });
  }

  listEvents(runId: string, afterSeq: number): AgentRunEvent[] {
    return this.database.db
      .prepare("SELECT * FROM agent_run_events WHERE run_id = ? AND seq > ? ORDER BY seq ASC")
      .all(runId, afterSeq)
      .map((row): AgentRunEvent => {
        const type = requireOneOf(AGENT_RUN_EVENT_TYPES, textColumn(row, "type"), "event type");
        return {
          id: textColumn(row, "event_id"),
          runId,
          seq: integerColumn(row, "seq"),
          type,
          timestamp: textColumn(row, "timestamp"),
          payload: parseEventPayload(type, JSON.parse(textColumn(row, "payload_json"))),
        };
      });
  }
}
