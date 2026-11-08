import { mediaTypeOf } from "./imagePlan";

/** The picture files in a list, in order, dropping anything else. */
export function pictureFiles(files: Iterable<File> | ArrayLike<File> | null | undefined): File[] {
  if (!files) return [];
  return Array.from(files).filter((file) => mediaTypeOf(file) !== undefined);
}

/** Whether a drag carries files, which is the only drag the composer takes. */
export function dragHasFiles(transfer: Pick<DataTransfer, "types"> | null): boolean {
  return transfer !== null && Array.from(transfer.types).includes("Files");
}

/** The part of a clipboard item that is read. */
export interface TransferItem {
  readonly kind: string;
  getAsFile(): File | null;
}

/** The pictures on the clipboard, if any: a screenshot, or an image copied from a page. Text is left to the field. */
export function picturesFromClipboard(data: { readonly items: ArrayLike<TransferItem> } | null): File[] {
  if (!data) return [];
  return Array.from(data.items).flatMap((item) => {
    if (item.kind !== "file") return [];
    const file = item.getAsFile();
    return file && mediaTypeOf(file) !== undefined ? [file] : [];
  });
}
