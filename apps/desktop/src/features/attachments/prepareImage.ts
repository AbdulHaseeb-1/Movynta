import { MAX_ATTACHMENT_BYTES } from "@movynta/contracts";
import {
  attachmentName,
  canSendUnchanged,
  fitWithin,
  JPEG_QUALITIES,
  mediaTypeOf,
  SHRINK_STEP,
  toBase64,
  withExtension,
  type Size,
} from "./imagePlan";
import { AttachmentError, type ComposerImage } from "./types";

/** A file this large is not decoded at all: the browser would need hundreds of megabytes to hold its pixels. */
export const MAX_SOURCE_BYTES = 40 * 1024 * 1024;

/** How many times a picture is made smaller before it is given up on. */
const MAX_SHRINKS = 6;

/** A picture that has been read: its size, and a way to save it as JPEG at any size. Release it when done. */
export interface OpenImage {
  readonly size: Size;
  encodeJpeg(size: Size, quality: number): Promise<Blob>;
  close(): void;
}

/** The part of the browser that reads and writes pictures, so the rest can be tested without one. */
export interface ImageCodec {
  open(file: Blob): Promise<OpenImage>;
}

/** The browser's own decoder and canvas. `createImageBitmap` also turns a photo upright by its EXIF orientation. */
export const browserCodec: ImageCodec = {
  async open(file) {
    const bitmap = await createImageBitmap(file);
    return {
      size: { width: bitmap.width, height: bitmap.height },
      async encodeJpeg(size, quality) {
        const canvas = new OffscreenCanvas(size.width, size.height);
        const context = canvas.getContext("2d");
        if (!context) throw new Error("A canvas is not available");
        // JPEG has no transparency; without a background, transparent pixels would turn black.
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, size.width, size.height);
        context.drawImage(bitmap, 0, 0, size.width, size.height);
        return canvas.convertToBlob({ type: "image/jpeg", quality });
      },
      close: () => bitmap.close(),
    };
  },
};

/** Saves the picture as a JPEG small enough to send: lower quality first, then fewer pixels. */
async function shrinkToFit(image: OpenImage): Promise<{ blob: Blob; size: Size } | undefined> {
  let size = fitWithin(image.size);
  for (let shrinks = 0; shrinks <= MAX_SHRINKS; shrinks += 1) {
    for (const quality of JPEG_QUALITIES) {
      // eslint-disable-next-line no-await-in-loop -- Each attempt is only worth making if the one before was too large.
      const blob = await image.encodeJpeg(size, quality);
      if (blob.size <= MAX_ATTACHMENT_BYTES) return { blob, size };
    }
    size = {
      width: Math.max(1, Math.round(size.width * SHRINK_STEP)),
      height: Math.max(1, Math.round(size.height * SHRINK_STEP)),
    };
  }
  return undefined;
}

/** Why a file that is not a PNG, JPEG, WebP or GIF is left out. */
export function unsupportedMessage(file: Pick<File, "name">): string {
  return `"${file.name.trim() || "The file"}" is not a picture the assistant can read. Use PNG, JPEG, WebP or GIF.`;
}

/**
 * Turns a file the user chose into a picture ready to send. A picture that is already small enough goes as it is;
 * a larger one is scaled to the longest side models make use of and saved as JPEG. Throws an AttachmentError, with
 * a message fit to show the user, for a file that cannot be sent.
 *
 * @param position Numbers pictures that have no name, such as ones pasted from the clipboard.
 */
export async function prepareImage(file: File, position = 1, codec: ImageCodec = browserCodec): Promise<ComposerImage> {
  const label = file.name.trim() || "The picture";
  const mediaType = mediaTypeOf(file);
  if (!mediaType) throw new AttachmentError(unsupportedMessage(file));
  if (file.size === 0) throw new AttachmentError(`"${label}" is empty.`);
  if (file.size > MAX_SOURCE_BYTES)
    throw new AttachmentError(`"${label}" is too large. Pictures can be up to ${MAX_SOURCE_BYTES / (1024 * 1024)} MB.`);

  let image: OpenImage;
  try {
    image = await codec.open(file);
  } catch {
    throw new AttachmentError(`"${label}" could not be read as a picture.`);
  }
  try {
    const name = attachmentName(file, mediaType, position);
    if (canSendUnchanged(file, mediaType, image.size)) {
      const data = toBase64(new Uint8Array(await file.arrayBuffer()));
      return {
        id: crypto.randomUUID(),
        name,
        mediaType,
        bytes: file.size,
        ...image.size,
        data,
        src: `data:${mediaType};base64,${data}`,
      };
    }
    const fitted = await shrinkToFit(image);
    if (!fitted) throw new AttachmentError(`"${label}" is too large to send, even after shrinking it.`);
    const data = toBase64(new Uint8Array(await fitted.blob.arrayBuffer()));
    return {
      id: crypto.randomUUID(),
      name: withExtension(name, "image/jpeg"),
      mediaType: "image/jpeg",
      bytes: fitted.blob.size,
      ...fitted.size,
      data,
      src: `data:image/jpeg;base64,${data}`,
    };
  } catch (error) {
    if (error instanceof AttachmentError) throw error;
    throw new AttachmentError(`"${label}" could not be prepared.`);
  } finally {
    image.close();
  }
}
