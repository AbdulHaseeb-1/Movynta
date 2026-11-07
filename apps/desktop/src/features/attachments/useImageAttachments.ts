import { MAX_ATTACHMENTS } from "@movynta/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MAX_ATTACHMENT_TOTAL_BYTES } from "@movynta/contracts";
import { fitsTotal, mediaTypeOf, uniqueName } from "./imagePlan";
import { prepareImage, unsupportedMessage } from "./prepareImage";
import { AttachmentError, type AttachmentUpload, type ComposerImage } from "./types";

export interface ImageAttachments {
  images: readonly ComposerImage[];
  /** True while chosen files are being read and shrunk. */
  preparing: boolean;
  /** How many chosen files are being read and shrunk. */
  pending: number;
  /** Why the last files were left out, or empty. */
  error: string;
  full: boolean;
  add: (files: readonly File[]) => Promise<void>;
  remove: (id: string) => void;
  clear: () => void;
  dismissError: () => void;
}

/** What the backend takes for the pictures of a request. */
export function toUploads(images: readonly ComposerImage[]): AttachmentUpload[] {
  return images.map(({ name, mediaType, data }) => ({ name, mediaType, data }));
}

/**
 * The pictures chosen for the next message. Files are read one after another, so a large set never holds more
 * than one decoded picture at a time, and no more than the limit are taken however fast files arrive.
 */
export function useImageAttachments(): ImageAttachments {
  const [images, setImages] = useState<ComposerImage[]>([]);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(0);
  // The pictures and the count being read are kept here as well as in state, so a burst of files sees the true count.
  const taken = useRef<ComposerImage[]>([]);
  const inFlight = useRef(0);
  // Bumped by clear(), so pictures still being read for a message that was sent are dropped.
  const generation = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const add = useCallback(async (files: readonly File[]) => {
    if (files.length === 0) return;
    // Files that are not pictures are named in the message and never take room from the ones that are.
    const pictures = files.filter((file) => mediaTypeOf(file) !== undefined);
    const problems = files.filter((file) => mediaTypeOf(file) === undefined).map(unsupportedMessage);
    const room = Math.max(0, MAX_ATTACHMENTS - taken.current.length - inFlight.current);
    const chosen = pictures.slice(0, room);
    if (chosen.length < pictures.length) problems.push(`A message can carry up to ${MAX_ATTACHMENTS} images.`);
    if (chosen.length === 0) {
      setError(problems.join(" "));
      return;
    }
    const mine = generation.current;
    const isCurrent = () => mine === generation.current && mounted.current;
    inFlight.current += chosen.length;
    setError("");
    setPending(inFlight.current);
    let position = taken.current.length;
    for (const file of chosen) {
      // The message was sent, or the composer closed, while earlier pictures were being read: skip the rest.
      if (!isCurrent()) break;
      position += 1;
      try {
        // eslint-disable-next-line no-await-in-loop -- One picture at a time keeps memory use flat.
        const image = await prepareImage(file, position);
        if (isCurrent() && !fitsTotal(taken.current, image.bytes)) {
          throw new AttachmentError(
            `"${image.name}" would take the images past ${MAX_ATTACHMENT_TOTAL_BYTES / (1024 * 1024)} MB together. Remove one or choose a smaller picture.`,
          );
        }
        if (isCurrent()) {
          // Pictures pasted from the clipboard are numbered by how many were there when they arrived, so two
          // that arrive together, or one after another's removal, would otherwise share a name.
          const name = uniqueName(
            image.name,
            taken.current.map((other) => other.name),
          );
          taken.current = [...taken.current, { ...image, name }];
          setImages(taken.current);
        }
      } catch (failure) {
        problems.push(failure instanceof AttachmentError ? failure.message : `"${file.name}" could not be added.`);
      } finally {
        if (isCurrent()) {
          inFlight.current -= 1;
          setPending(inFlight.current);
        }
      }
    }
    if (isCurrent()) setError(problems.join(" "));
  }, []);

  const remove = useCallback((id: string) => {
    taken.current = taken.current.filter((image) => image.id !== id);
    setImages(taken.current);
    setError("");
  }, []);

  const clear = useCallback(() => {
    generation.current += 1;
    taken.current = [];
    inFlight.current = 0;
    setImages([]);
    setPending(0);
    setError("");
  }, []);

  const dismissError = useCallback(() => setError(""), []);

  return useMemo(
    () => ({
      images,
      preparing: pending > 0,
      pending,
      error,
      full: images.length + pending >= MAX_ATTACHMENTS,
      add,
      remove,
      clear,
      dismissError,
    }),
    [images, pending, error, add, remove, clear, dismissError],
  );
}
