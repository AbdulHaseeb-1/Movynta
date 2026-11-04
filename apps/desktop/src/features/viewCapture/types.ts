import type { Object3D } from "three";
import type { editorCommandListSchema, ViewCaptureRequest, ViewCaptureResult } from "@movynta/editor-protocol";
import type { z } from "zod";

/** The part of the editor scene a capture reads: the objects the assistant can name, by id. */
export interface CaptureScene {
  entries(): IterableIterator<readonly [string, Object3D]>;
  getObject(id: string): Object3D | undefined;
  /** The id of the object `node` belongs to, or undefined for something the editor does not track. */
  idOf(node: Object3D): string | undefined;
}

/** What the backend decides about a capture, apart from what the assistant asked for. */
export interface CaptureOptions {
  /** False to measure only: nothing is drawn, so no pixels are produced. */
  withImages: boolean;
  candidate?: { proposalId: string; revision: number; commands: z.infer<typeof editorCommandListSchema> };
}

/** Draws the scene as asked. Throws, with a reason fit to show the assistant, when it cannot. */
export type ViewCaptureHandler = (request: ViewCaptureRequest, options: CaptureOptions) => ViewCaptureResult;
