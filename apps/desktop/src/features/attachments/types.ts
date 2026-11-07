import type { AttachmentMediaType } from "@movynta/contracts";

/** A picture chosen for the next message, ready to send. */
export interface ComposerImage {
  /** Tells this picture from the others in the composer, even when two have the same name. */
  id: string;
  name: string;
  mediaType: AttachmentMediaType;
  /** Size of the file that will be sent, in bytes. */
  bytes: number;
  width: number;
  height: number;
  /** The file's bytes as base64 text, which is how the backend takes them. */
  data: string;
  /** A data: URL the picture can be shown from. */
  src: string;
}

/** What the backend takes for one picture. */
export interface AttachmentUpload {
  name: string;
  mediaType: AttachmentMediaType;
  data: string;
}

/** A picture shown in a chat message: its name, and its pixels while this session still has them. */
export interface MessageAttachment {
  /** Tells this picture from the others of its message, even when two share a name. */
  id: string;
  name: string;
  src?: string | undefined;
}

/** Why a file was left out, in words fit to show the user. */
export class AttachmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AttachmentError";
  }
}
