import type { AttachmentMediaType } from "@movynta/contracts";
import type { AttachmentUpload } from "../modules/agent-runs/run-attachments.js";

const HEADS: Readonly<Record<AttachmentMediaType, Buffer>> = {
  "image/png": Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  "image/jpeg": Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  "image/gif": Buffer.from("GIF89a", "latin1"),
  "image/webp": Buffer.concat([Buffer.from("RIFF", "latin1"), Buffer.alloc(4), Buffer.from("WEBP", "latin1")]),
};

/** A picture as a client sends it: a file that starts like `mediaType` and is `bytes` long. */
export function pictureUpload(mediaType: AttachmentMediaType, bytes = 64, name = "ref.png"): AttachmentUpload {
  const head = HEADS[mediaType];
  return {
    name,
    mediaType,
    data: Buffer.concat([head, Buffer.alloc(Math.max(0, bytes - head.length), 1)]).toString("base64"),
  };
}
