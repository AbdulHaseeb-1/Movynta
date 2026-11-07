import { isTauri } from "@tauri-apps/api/core";
import { downloadBlob } from "./downloadBlob";

/** How a save ended. */
export type SaveOutcome =
  /** The file was written to `path`, which the user chose. */
  | { status: "saved"; path: string }
  /** The browser was asked to download the file; where it goes is the browser's choice. */
  | { status: "downloaded" }
  /** The user closed the Save dialog without choosing a place. */
  | { status: "cancelled" };

/** The file types the Save dialog offers. */
export interface SaveFilter {
  name: string;
  extensions: string[];
}

/** The functions a native save needs, so they can be replaced in tests. */
export interface NativeSave {
  chooseLocation: (options: { title: string; defaultPath: string; filters: SaveFilter[] }) => Promise<string | null>;
  write: (path: string, bytes: Uint8Array) => Promise<void>;
}

const nativeSave: NativeSave = {
  async chooseLocation(options) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    return save(options);
  },
  async write(path, bytes) {
    const { writeFile } = await import("@tauri-apps/plugin-fs");
    await writeFile(path, bytes);
  },
};

/**
 * Saves a file where the user chooses. The desktop app asks with the system's Save dialog and writes the file
 * itself, so the user sees where it went. A page opened in a browser (during development) falls back to a download.
 */
export async function saveFile(
  blob: Blob,
  fileName: string,
  options: { title: string; filters: SaveFilter[]; native?: NativeSave; desktop?: boolean },
): Promise<SaveOutcome> {
  const desktop = options.desktop ?? isTauri();
  if (!desktop) {
    downloadBlob(blob, fileName);
    return { status: "downloaded" };
  }
  const native = options.native ?? nativeSave;
  const path = await native.chooseLocation({ title: options.title, defaultPath: fileName, filters: options.filters });
  if (path === null) return { status: "cancelled" };
  await native.write(path, new Uint8Array(await blob.arrayBuffer()));
  return { status: "saved", path };
}

/** The last part of a path, whichever separator it uses, for showing where a file went. */
export function fileNameOf(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}
