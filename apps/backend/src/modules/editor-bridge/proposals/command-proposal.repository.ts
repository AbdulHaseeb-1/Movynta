import { Injectable } from "@nestjs/common";
import { z } from "zod";
import { DatabaseService } from "../../persistence/database.service.js";
import { optionalTextColumn, textColumn } from "../../persistence/row.js";
import type { SqlRow } from "../../persistence/persistence.types.js";
import { editorCommandListSchema } from "../../../shared/schemas/editor-command.schema.js";
import { requireOneOf } from "../../../shared/guards/enum.guard.js";
import type { CommandExecutionResult } from "../editor-bridge.types.js";
import type { CommandProposalRecord, NewProposal, ProposalStatus } from "./proposals.types.js";

export const PROPOSAL_STATUSES = ["proposed", "applying", "applied", "failed", "rejected"] as const;

// JSON storage drops undefined fields, so optional values may be absent or null.
const storedResultSchema = z.object({
  proposalId: z.string(),
  status: z.enum(["applied", "failed", "revision_conflict"]),
  revision: z.number().nullish(),
  message: z.string().nullish(),
  results: z.array(
    z.object({ commandId: z.string(), status: z.enum(["applied", "failed"]), message: z.string().nullish() }),
  ),
});

/** Stored results are written by this service; reading them back restores the exact outcome. */
function parseStoredResult(json: string): CommandExecutionResult {
  const stored = storedResultSchema.parse(JSON.parse(json));
  return {
    proposalId: stored.proposalId,
    status: stored.status,
    revision: stored.revision ?? undefined,
    message: stored.message ?? undefined,
    results: stored.results.map((item) => ({
      commandId: item.commandId,
      status: item.status,
      message: item.message ?? undefined,
    })),
  };
}

function toRecord(row: SqlRow): CommandProposalRecord {
  const resultJson = optionalTextColumn(row, "result_json");
  return {
    id: textColumn(row, "id"),
    runId: textColumn(row, "run_id"),
    projectId: textColumn(row, "project_id"),
    clientId: textColumn(row, "client_id"),
    baseRevision: Number(row["base_revision"]),
    summary: textColumn(row, "summary"),
    commands: editorCommandListSchema.parse(JSON.parse(textColumn(row, "commands_json"))),
    requiresApproval: Number(row["requires_approval"]) === 1,
    status: requireOneOf(PROPOSAL_STATUSES, textColumn(row, "status"), "proposal status"),
    result: resultJson === undefined ? undefined : parseStoredResult(resultJson),
    createdAt: textColumn(row, "created_at"),
    updatedAt: textColumn(row, "updated_at"),
  };
}

@Injectable()
export class CommandProposalRepository {
  constructor(private readonly database: DatabaseService) {}

  insert(proposal: NewProposal): void {
    this.database
      .db.prepare(
        `INSERT INTO editor_proposals (id, run_id, project_id, client_id, base_revision, summary, commands_json, requires_approval, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'proposed', ?, ?)`,
      )
      .run(
        proposal.id,
        proposal.runId,
        proposal.projectId,
        proposal.clientId,
        proposal.baseRevision,
        proposal.summary,
        JSON.stringify(proposal.commands),
        proposal.requiresApproval ? 1 : 0,
        proposal.now,
        proposal.now,
      );
  }

  find(proposalId: string): CommandProposalRecord | undefined {
    const row = this.database.db.prepare("SELECT * FROM editor_proposals WHERE id = ?").get(proposalId);
    return row ? toRecord(row) : undefined;
  }

  /** Moves a proposal from one of `from` to `to` in one conditional write. */
  transition(
    proposalId: string,
    from: readonly ProposalStatus[],
    to: ProposalStatus,
    now: string,
    result?: CommandExecutionResult,
  ): boolean {
    const placeholders = from.map(() => "?").join(", ");
    const update = this.database.db.prepare(
      `UPDATE editor_proposals SET status = ?, result_json = COALESCE(?, result_json), updated_at = ?
       WHERE id = ? AND status IN (${placeholders})`,
    );
    const changes = update.run(to, result ? JSON.stringify(result) : null, now, proposalId, ...from).changes;
    return Number(changes) === 1;
  }
}
