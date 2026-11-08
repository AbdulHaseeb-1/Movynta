import type { Object3D } from "three";
import { z } from "zod";
import { backendDownload, backendUpload, errorMessage } from "@/lib/backend";
import { isModelFormat, type ModelFormat } from "./modelFormats";
import { parseModel } from "./parseModel";
import { prepareModel } from "./prepareModel";

const importedStepSchema = z.object({
  kind: z.literal("import"),
  assetId: z.string(),
  objectId: z.string(),
  name: z.string(),
  format: z.string(),
});

/** A saved model could not be fetched or read. Keeps the underlying failure for debugging. */
export class SavedModelError extends Error {
  readonly cause: unknown;

  constructor(name: string, cause: unknown) {
    super(`The imported model "${name}" could not be opened. ${errorMessage(cause)}`);
    this.name = "SavedModelError";
    this.cause = cause;
  }
}

/** A model file being sent to the backend. */
export interface ModelUpload {
  name: string;
  format: ModelFormat;
  objectId: string;
}

/** Saves a model file with the project, so it is there when the project is reopened. */
export function uploadModel(
  projectId: string,
  upload: ModelUpload,
  data: Blob,
): Promise<z.infer<typeof importedStepSchema>> {
  const query = new URLSearchParams({
    name: upload.name,
    format: upload.format,
    objectId: upload.objectId,
  });
  return backendUpload(`/projects/${projectId}/assets?${query.toString()}`, importedStepSchema, data);
}

/** A model saved with a project, as the scene step that placed it. */
export interface SavedModel {
  assetId: string;
  name: string;
  format: string;
}

/** Fetches a saved model and prepares it exactly as it was when it was first imported. */
export async function loadSavedModel(projectId: string, saved: SavedModel): Promise<Object3D> {
  try {
    if (!isModelFormat(saved.format)) throw new Error(`.${saved.format} files are not supported`);
    const data = await backendDownload(`/projects/${projectId}/assets/${saved.assetId}`);
    const parsed = await parseModel(saved.format, data);
    return prepareModel(parsed, saved.name).object;
  } catch (failure) {
    throw new SavedModelError(saved.name, failure);
  }
}
