import { ATTACHMENT_MEDIA_TYPES, type AttachmentSummary } from "@movynta/contracts";
import { z } from "zod";

const attachmentSummariesSchema = z.array(
  z.object({ name: z.string(), mediaType: z.enum(ATTACHMENT_MEDIA_TYPES), bytes: z.number() }),
);

/** Reads the pictures a run was started with, as `agent_runs.attachments_json` stores them. A missing column means none. */
export function parseAttachmentSummaries(json: string | undefined): readonly AttachmentSummary[] {
  return json === undefined ? [] : attachmentSummariesSchema.parse(JSON.parse(json));
}
