/** The 3D file formats the app can open. Each is read in the app, not on the backend. */
export const MODEL_FORMATS = ["glb", "gltf", "obj", "fbx", "stl", "ply", "dae"] as const;
/** A 3D model file format the importer can read. */
export type ModelFormat = (typeof MODEL_FORMATS)[number];

/** The file dialog's filter. */
export const MODEL_FILE_ACCEPT = MODEL_FORMATS.map((format) => `.${format}`).join(",");

/** The backend refuses larger files, so they are turned away before being read. */
export const MAX_MODEL_BYTES = 64 * 1024 * 1024;

/** How each format is named for people. */
export const MODEL_FORMAT_NAMES: Readonly<Record<ModelFormat, string>> = {
  glb: "GLB",
  gltf: "glTF",
  obj: "OBJ",
  fbx: "FBX",
  stl: "STL",
  ply: "PLY",
  dae: "Collada",
};

/** Whether a file extension is a model format the importer can read. */
export function isModelFormat(value: string): value is ModelFormat {
  return MODEL_FORMATS.some((format) => format === value);
}

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot < 0 ? "" : fileName.slice(dot + 1).toLowerCase();
}

/** The format of a file, judged by its extension, or undefined if the app cannot open it. */
export function modelFormatOf(fileName: string): ModelFormat | undefined {
  const extension = extensionOf(fileName);
  return isModelFormat(extension) ? extension : undefined;
}

/** What to tell the user about a file that cannot be imported, with a way forward where there is one. */
export function unsupportedFileMessage(fileName: string): string {
  const extension = extensionOf(fileName);
  if (extension === "blend")
    return "Blender files cannot be opened directly. In Blender choose File → Export → glTF 2.0 (.glb), then import that file.";
  const supported = MODEL_FORMATS.map((format) => MODEL_FORMAT_NAMES[format]).join(", ");
  return `${extension ? `.${extension} files` : "This file"} cannot be imported. Use ${supported}.`;
}

/** A file size as text for people: bytes, KB or MB. */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
