const MAX_BASE_LENGTH = 40;

/**
 * An id for an imported model, built from its file name, such as "robot_a3f9" for "Robot v2.glb".
 * Ids use letters, digits, "_" and "-", which is all the scene accepts. The suffix keeps repeated
 * imports of one file apart, even after earlier copies were deleted.
 */
export function makeObjectId(
  fileName: string,
  taken: { has: (id: string) => boolean },
  suffix: () => string = () => crypto.randomUUID().slice(0, 4),
): string {
  const dot = fileName.lastIndexOf(".");
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
  const base =
    stem
      .replace(/[^A-Za-z0-9_-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, MAX_BASE_LENGTH) || "model";
  for (;;) {
    const id = `${base}_${suffix()}`;
    if (!taken.has(id)) return id;
  }
}
