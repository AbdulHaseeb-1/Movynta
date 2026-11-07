import {
  isAttachmentMediaType,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_TOTAL_BYTES,
  MAX_ATTACHMENT_EDGE,
  type AttachmentMediaType,
} from "@movynta/contracts";

export interface Size {
  width: number;
  height: number;
}

/** The quality steps tried, best first, when a picture has to be saved as JPEG. */
export const JPEG_QUALITIES = [0.9, 0.8, 0.7, 0.55] as const;

/** How much smaller a picture is made each time it is still too large at the lowest quality. */
export const SHRINK_STEP = 0.75;

const EXTENSION_TYPES: Readonly<Record<string, AttachmentMediaType | undefined>> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

/** The type of a file chosen by the user, or undefined if models cannot read it. */
export function mediaTypeOf(file: Pick<File, "type" | "name">): AttachmentMediaType | undefined {
  const declared = file.type.toLowerCase();
  if (isAttachmentMediaType(declared)) return declared;
  if (declared === "image/jpg") return "image/jpeg";
  if (declared !== "") return undefined;
  // Some systems give no type for a dropped file; the extension is the only hint left.
  const extension = /\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toLowerCase();
  return extension === undefined ? undefined : EXTENSION_TYPES[extension];
}

/** The size a picture is sent at: unchanged if its longer side fits, otherwise scaled down to fit. */
export function fitWithin(size: Size, edge: number = MAX_ATTACHMENT_EDGE): Size {
  const longest = Math.max(size.width, size.height);
  if (longest <= edge) return { width: size.width, height: size.height };
  const scale = edge / longest;
  return { width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)) };
}

/**
 * Whether the file can be sent as it is. Re-encoding costs sharpness, so a picture that already fits is left
 * alone. An animated format is not, since models would see only its first frame of an unknown size.
 */
export function canSendUnchanged(file: Pick<File, "size">, mediaType: AttachmentMediaType, size: Size): boolean {
  if (mediaType === "image/gif") return false;
  const fitted = fitWithin(size);
  return file.size <= MAX_ATTACHMENT_BYTES && fitted.width === size.width && fitted.height === size.height;
}

/** Whether one more picture of `bytes` still keeps the pictures of a message within their total size limit. */
export function fitsTotal(taken: readonly { readonly bytes: number }[], bytes: number): boolean {
  return taken.reduce((sum, picture) => sum + picture.bytes, bytes) <= MAX_ATTACHMENT_TOTAL_BYTES;
}

/** A file name for the picture, with a name for pictures that have none, such as ones pasted from the clipboard. */
export function attachmentName(file: Pick<File, "name">, mediaType: AttachmentMediaType, index = 1): string {
  const name = file.name.trim();
  if (name && !/^image\.(png|jpe?g|webp|gif)$/i.test(name)) return name;
  const extension = mediaType === "image/jpeg" ? "jpg" : mediaType.slice("image/".length);
  return `pasted-image-${index}.${extension}`;
}

/**
 * A name none of `taken` has, so two pictures of a message can be told apart in the chat and on their remove buttons.
 * A repeat gets a number before its extension: "shot.png", "shot (2).png". Names are compared without regard to case,
 * as file names are on the systems the app runs on.
 */
export function uniqueName(name: string, taken: readonly string[]): string {
  const used = new Set(taken.map((other) => other.toLowerCase()));
  if (!used.has(name.toLowerCase())) return name;
  const dot = name.lastIndexOf(".");
  const [base, extension] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
  for (let number = 2; ; number += 1) {
    const candidate = `${base} (${number})${extension}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
}

/** Replaces the extension of a name, for a picture saved in another format. */
export function withExtension(name: string, mediaType: AttachmentMediaType): string {
  const extension = mediaType === "image/jpeg" ? "jpg" : mediaType.slice("image/".length);
  const base = name.replace(/\.[a-z0-9]+$/i, "");
  return `${base || "image"}.${extension}`;
}

/** The base64 text of bytes. Done in chunks, because spreading a large array into one call overflows the stack. */
export function toBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = "";
  for (let at = 0; at < bytes.length; at += CHUNK) binary += String.fromCharCode(...bytes.subarray(at, at + CHUNK));
  return btoa(binary);
}
