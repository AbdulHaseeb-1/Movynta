import type { ObjectSummary, SceneSummary } from "./summary";

/**
 * Compares the scene a history made when it was saved with the scene today's editor makes from it. They must agree
 * on everything except two things, which changed on purpose and are written down here:
 *
 * 1. Names. Today's editor gives siblings different names (`Part`, `Part.001`), where the editor of the time allowed
 *    two with the same name. A name is numbered when the object is created or renamed, among the siblings it has then,
 *    and stays when the object moves later; so an object that was alone in its parent at the end may still carry a
 *    number from a crowded place it started in. A name may therefore differ only by a `.001`-style number, and the
 *    name it has now must be unique among its siblings. A name unique before and now, with no number added, is
 *    always accepted.
 *    A mesh carries the name of its object, so a mesh name is compared the same way, with the number removed from both.
 * 2. The way a cut names the part it uses. That is not seen here as a difference because the summary writes it as
 *    which mesh the path leads to (see `summary.ts`), so a path by index and one by name that lead to the same mesh agree.
 *
 * Returns what differs, one line each. An empty list means the histories agree.
 */
const NUMBER_SUFFIX = /\.\d{3,}$/;
const baseName = (name: string): string => name.replace(NUMBER_SUFFIX, "");

function siblingCounts(objects: readonly ObjectSummary[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const object of objects) {
    const key = `${object.parentId ?? ""}\u0000${object.name}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function differences(label: string, expected: unknown, actual: unknown): string[] {
  const left = JSON.stringify(expected);
  const right = JSON.stringify(actual);
  return left === right ? [] : [`${label}: expected ${left}, got ${right}`];
}

export function compareSummaries(expected: SceneSummary, actual: SceneSummary): string[] {
  const found: string[] = [];
  if (expected.revision !== actual.revision) found.push(`revision: expected ${expected.revision}, got ${actual.revision}`);

  const expectedIds = expected.objects.map((object) => object.id);
  const actualIds = actual.objects.map((object) => object.id);
  found.push(...differences("object ids", expectedIds, actualIds));

  const expectedCounts = siblingCounts(expected.objects);
  const actualCounts = siblingCounts(actual.objects);
  const actualById = new Map(actual.objects.map((object) => [object.id, object]));
  for (const was of expected.objects) {
    const now = actualById.get(was.id);
    if (!now) continue;
    const { name: wasName, ...wasRest } = was;
    const { name: nowName, ...nowRest } = now;
    found.push(...differences(`object ${was.id}`, wasRest, nowRest));
    const wasUnique = (expectedCounts.get(`${was.parentId ?? ""}\u0000${wasName}`) ?? 0) === 1;
    if (wasUnique && wasName === nowName && (actualCounts.get(`${now.parentId ?? ""}\u0000${nowName}`) ?? 0) === 1) continue;
    if (baseName(wasName) !== baseName(nowName)) found.push(`object ${was.id} name: expected ${wasName} or a numbered form of it, got ${nowName}`);
    if ((actualCounts.get(`${now.parentId ?? ""}\u0000${nowName}`) ?? 0) !== 1) found.push(`object ${was.id} name ${nowName} is shared with a sibling`);
  }

  const unnumbered = (meshes: SceneSummary["meshes"]) => meshes.map((mesh) => ({ ...mesh, name: baseName(mesh.name) }));
  found.push(...differences("meshes", unnumbered(expected.meshes), unnumbered(actual.meshes)));
  return found;
}
