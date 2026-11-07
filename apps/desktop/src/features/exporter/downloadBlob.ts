/** How long the object URL stays valid. The browser starts the download as soon as the link is clicked; this is only a margin. */
const URL_LIFETIME_MS = 1000;

/** Saves a file through the browser's download, which the desktop app's web view also performs. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), URL_LIFETIME_MS);
}
