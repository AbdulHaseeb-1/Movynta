import {
  base64Length,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_TOTAL_BYTES,
  MAX_ATTACHMENT_NAME_LENGTH,
  MAX_ATTACHMENTS,
  type AttachmentMediaType,
  type AttachmentSummary,
} from "@movynta/contracts";
import type { AgentInputItem } from "@openai/agents";
import { ValidationFailedError } from "../../common/errors/app-error.js";

/** A picture the user attached to a request, decoded and checked. `data` is base64 text, as the model API takes it. */
export interface RunAttachment extends AttachmentSummary {
  readonly data: string;
}

/** A picture as the client sent it, before any check. */
export interface AttachmentUpload {
  readonly name: string;
  readonly mediaType: AttachmentMediaType;
  readonly data: string;
}

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
/** Enough bytes of a file to recognise every format below. */
const SIGNATURE_BYTES = 12;

/** What the first bytes of each format look like. A client's claim about the type is not trusted. */
const SIGNATURES: Readonly<Record<AttachmentMediaType, (head: Buffer) => boolean>> = {
  "image/png": (head) => head.length >= 8 && head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  "image/jpeg": (head) => head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff,
  "image/gif": (head) => head.length >= 6 && ["GIF87a", "GIF89a"].includes(head.subarray(0, 6).toString("latin1")),
  "image/webp": (head) => head.length >= 12 && head.subarray(0, 4).toString("latin1") === "RIFF" && head.subarray(8, 12).toString("latin1") === "WEBP",
};

/** The name shown in the chat and given to the model: no path, no control characters, never empty, never long. */
export function cleanAttachmentName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const printable = Array.from(base)
    .filter((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127)
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  return printable.slice(0, MAX_ATTACHMENT_NAME_LENGTH) || "image";
}

function decodedBytes(data: string): number {
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return (data.length / 4) * 3 - padding;
}

/**
 * Checks the pictures of a request: how many, that each is real base64, within the size limit, and that its first
 * bytes are those of the format it claims. Throws a validation error that names the picture at fault.
 */
export function checkAttachments(uploads: readonly AttachmentUpload[]): RunAttachment[] {
  if (uploads.length > MAX_ATTACHMENTS)
    throw new ValidationFailedError(`A request can carry at most ${MAX_ATTACHMENTS} images`);
  const checked = uploads.map((upload) => {
    const name = cleanAttachmentName(upload.name);
    const { data } = upload;
    if (data.length > base64Length(MAX_ATTACHMENT_BYTES) || data.length % 4 !== 0 || !BASE64.test(data))
      throw new ValidationFailedError(`"${name}" is not a valid image`);
    const bytes = decodedBytes(data);
    if (bytes > MAX_ATTACHMENT_BYTES)
      throw new ValidationFailedError(`"${name}" is larger than ${MAX_ATTACHMENT_BYTES / (1024 * 1024)} MB`);
    const head = Buffer.from(data.slice(0, Math.ceil((SIGNATURE_BYTES * 4) / 3)), "base64");
    if (!SIGNATURES[upload.mediaType](head))
      throw new ValidationFailedError(`"${name}" is not a ${upload.mediaType.slice("image/".length).toUpperCase()} image`);
    return { name, mediaType: upload.mediaType, bytes, data };
  });
  const total = checked.reduce((sum, picture) => sum + picture.bytes, 0);
  if (total > MAX_ATTACHMENT_TOTAL_BYTES)
    throw new ValidationFailedError(`The images add up to more than ${MAX_ATTACHMENT_TOTAL_BYTES / (1024 * 1024)} MB; send fewer or smaller ones`);
  return checked;
}

/** What is kept of the pictures once the run has them: names, types and sizes. */
export function summarizeAttachments(attachments: readonly RunAttachment[]): AttachmentSummary[] {
  return attachments.map(({ name, mediaType, bytes }) => ({ name, mediaType, bytes }));
}

/**
 * The user's message with its pictures, as the model receives it. Each picture follows a line that numbers it, so
 * the user can say "the second image". The message is the first part and stays exactly as typed.
 */
export function messageWithAttachments(message: string, attachments: readonly RunAttachment[]): AgentInputItem[] {
  return [
    {
      role: "user",
      content: [
        { type: "input_text", text: message },
        ...attachments.flatMap((attachment, index) => [
          { type: "input_text" as const, text: `Attached image ${index + 1} of ${attachments.length}: ${attachment.name}` },
          { type: "input_image" as const, image: `data:${attachment.mediaType};base64,${attachment.data}` },
        ]),
      ],
    },
  ];
}
