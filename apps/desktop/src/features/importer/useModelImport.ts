import { useCallback, useState, type RefObject } from "react";
import type { EditorScene } from "@/features/assistant";
import { errorMessage } from "@/lib/backend";
import { uploadModel } from "./importApi";
import {
  formatFileSize,
  MAX_MODEL_BYTES,
  modelFormatOf,
  unsupportedFileMessage,
} from "./modelFormats";
import { makeObjectId } from "./objectId";
import { parseModel } from "./parseModel";
import { disposeModel, prepareModel } from "./prepareModel";

export interface ImportedModelSummary {
  name: string;
  triangles: number;
}

interface ModelImportOptions {
  editor: RefObject<EditorScene | null>;
  /** Returns the id of the project the model belongs to, creating the project first if needed. */
  ensureProject: () => Promise<string>;
  onImported?: (model: ImportedModelSummary) => void;
}

export interface ModelImport {
  importing: boolean;
  /** Why the last import failed, until it is dismissed or another import starts. */
  error: string;
  dismissError: () => void;
  importFile: (file: File) => Promise<void>;
}

/**
 * Imports a model file into the workspace: reads it, saves it with the project, then places it in the
 * scene. The file is saved first, so nothing appears that would be missing after reopening.
 */
export function useModelImport({
  editor,
  ensureProject,
  onImported,
}: ModelImportOptions): ModelImport {
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");

  const importFile = useCallback(
    async (file: File) => {
      setError("");
      const format = modelFormatOf(file.name);
      if (!format) return setError(unsupportedFileMessage(file.name));
      if (file.size === 0) return setError(`${file.name} is empty.`);
      if (file.size > MAX_MODEL_BYTES)
        return setError(
          `${file.name} is ${formatFileSize(file.size)}. Models can be at most ${formatFileSize(MAX_MODEL_BYTES)}.`,
        );
      const scene = editor.current;
      if (!scene) return setError("The editor is still loading. Try again in a moment.");

      setImporting(true);
      let prepared: ReturnType<typeof prepareModel> | undefined;
      try {
        const data = await file.arrayBuffer();
        prepared = prepareModel(await parseModel(format, data), file.name);
        const projectId = await ensureProject();
        scene.bindProject(projectId);
        const objectId = makeObjectId(file.name, scene.objectIds());
        await uploadModel(projectId, { name: file.name, format, objectId }, new Blob([data]));
        scene.importObject(objectId, prepared.object);
        const added = prepared;
        prepared = undefined;
        onImported?.({ name: file.name, triangles: added.triangles });
      } catch (failure) {
        if (prepared) disposeModel(prepared.object);
        setError(`Could not import ${file.name}. ${errorMessage(failure)}`);
      } finally {
        setImporting(false);
      }
    },
    [editor, ensureProject, onImported],
  );

  return {
    importing,
    error,
    dismissError: () => setError(""),
    importFile,
  };
}
