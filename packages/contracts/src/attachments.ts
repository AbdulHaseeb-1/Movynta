/**
 * Pictures a user attaches to a request to the assistant. The desktop and the backend both read these limits, so a
 * picture the composer accepts is one the backend accepts.
 */

/** Picture formats every supported model provider can read. */
export const ATTACHMENT_MEDIA_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export type AttachmentMediaType = (typeof ATTACHMENT_MEDIA_TYPES)[number];

/** Pictures one request can carry. More would cost context without helping the assistant. */
export const MAX_ATTACHMENTS = 8;

/** The largest picture, in bytes, after the desktop has shrunk it. */
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

/** The most bytes all the pictures of one request may add up to. A request is sent as one body, so this bounds it. */
export const MAX_ATTACHMENT_TOTAL_BYTES = 24 * 1024 * 1024;

/**
 * The longest side, in pixels, a picture keeps. Larger pictures are scaled down before they are sent: models
 * downscale them anyway, so the extra pixels would only add upload time and cost.
 */
export const MAX_ATTACHMENT_EDGE = 1568;

export const MAX_ATTACHMENT_NAME_LENGTH = 120;

/** What the backend keeps of a picture after the request: enough to list it in the chat, never the pixels. */
export interface AttachmentSummary {
  readonly name: string;
  readonly mediaType: AttachmentMediaType;
  readonly bytes: number;
}

/** Whether a string names a picture format that the assistant accepts. */
export function isAttachmentMediaType(value: string): value is AttachmentMediaType {
  return (ATTACHMENT_MEDIA_TYPES as readonly string[]).includes(value);
}

/** The size of the base64 text that carries `bytes` bytes. */
export function base64Length(bytes: number): number {
  return Math.ceil(bytes / 3) * 4;
}
