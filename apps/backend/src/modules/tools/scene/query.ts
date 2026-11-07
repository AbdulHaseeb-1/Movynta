import { globMatches } from "./glob.js";
import { roundVec, type IndexedObject, type SceneIndex, type Vec3 } from "./scene-index.js";

/** A minimum and maximum for one axis value. Either bound may be left out. */
export interface Range {
  min?: number | undefined;
  max?: number | undefined;
}

/** Ranges for the axes. An axis left out is not filtered. */
export type AxisRanges = { x?: Range | undefined; y?: Range | undefined; z?: Range | undefined };

/** The object types a query can select. */
export type ObjectType = "mesh" | "empty" | "collection" | "camera" | "light";

/** What to select. Every filter that is given must hold; one that is left out matches everything. */
export interface ObjectQuery {
  /** Matches the object's own name; `*` is any run of characters and `?` is one. */
  nameMatches?: string | undefined;
  type?: readonly ObjectType[] | undefined;
  /** Direct children of this object. Null selects the top level of the scene. */
  parentId?: string | null | undefined;
  /** Anything below this object, at any depth. */
  withinId?: string | undefined;
  visible?: boolean | undefined;
  selected?: boolean | undefined;
  /** World extents of the object, including what is inside it. */
  size?: AxisRanges | undefined;
  /** World position of the center of the object's bounds. */
  position?: AxisRanges | undefined;
  /** What to order the matches by. Position and size order by the named axis. */
  sortBy: "scene" | "name" | "size" | "x" | "y" | "z";
  descending: boolean;
  offset: number;
  limit: number;
}

/** One object that a query matched, with what a command needs to refer to it. */
export interface QueryMatch {
  id: string;
  name: string;
  type: string;
  parentId: string | null;
  size: [number, number, number] | null;
  center: [number, number, number] | null;
}

/** The matches of a query, one page at a time. */
export interface QueryResult {
  /** Every object that matched, whatever the limit. */
  total: number;
  matches: QueryMatch[];
  hasMore: boolean;
  nextOffset?: number;
}

const AXIS_INDEX = { x: 0, y: 1, z: 2 } as const;
const AXIS_NAMES = ["x", "y", "z"] as const;

function inRange(value: number, range: Range | undefined): boolean {
  if (!range) return true;
  return (range.min === undefined || value >= range.min) && (range.max === undefined || value <= range.max);
}

/** True when `vector` is known and every axis that has a range lies inside it. A missing vector fails any range. */
function withinRanges(vector: Vec3 | null, ranges: AxisRanges | undefined): boolean {
  if (!ranges) return true;
  const given = AXIS_NAMES.filter((axis) => ranges[axis] !== undefined);
  if (given.length === 0) return true;
  if (!vector) return false;
  return given.every((axis) => inRange(vector[AXIS_INDEX[axis]], ranges[axis]));
}

function matchesQuery(
  index: SceneIndex,
  entry: IndexedObject,
  query: ObjectQuery,
  selected: ReadonlySet<string>,
): boolean {
  const { object } = entry;
  if (query.nameMatches !== undefined && !globMatches(query.nameMatches, object.name)) return false;
  if (query.type !== undefined && !query.type.includes(object.type)) return false;
  if (query.parentId !== undefined && index.parentOf(object.id) !== query.parentId) return false;
  if (query.visible !== undefined && (object.visible ?? true) !== query.visible) return false;
  if (query.selected !== undefined && selected.has(object.id) !== query.selected) return false;
  if (!withinRanges(entry.size, query.size)) return false;
  if (!withinRanges(entry.center, query.position)) return false;
  return true;
}

function sortKey(entry: IndexedObject, sortBy: ObjectQuery["sortBy"]): number | string | undefined {
  if (sortBy === "name") return entry.object.name.toLowerCase();
  if (sortBy === "size") return entry.size ? entry.size[0] * entry.size[1] * entry.size[2] : undefined;
  if (sortBy === "x" || sortBy === "y" || sortBy === "z") return entry.center?.[AXIS_INDEX[sortBy]];
  return undefined;
}

/** Selects objects by rule, so the assistant can name a group of objects by what they are instead of by id. */
export function queryObjects(index: SceneIndex, query: ObjectQuery, selectedIds: readonly string[]): QueryResult {
  const selected = new Set(selectedIds);
  const pool = query.withinId === undefined ? [...index.walk()] : [...index.walk(query.withinId)];
  const found = pool.filter((entry) => matchesQuery(index, entry, query, selected));

  if (query.sortBy !== "scene") {
    const direction = query.descending ? -1 : 1;
    found.sort((a, b) => {
      const left = sortKey(a, query.sortBy);
      const right = sortKey(b, query.sortBy);
      // Objects with nothing to sort by go last, whichever way the rest are ordered.
      if (left === undefined || right === undefined) return left === right ? 0 : left === undefined ? 1 : -1;
      return (left < right ? -1 : left > right ? 1 : 0) * direction;
    });
  }
  const page = found.slice(query.offset, query.offset + query.limit);
  const result: QueryResult = {
    total: found.length,
    matches: page.map((entry) => ({
      id: entry.object.id,
      name: entry.object.name,
      type: entry.object.type,
      parentId: index.parentOf(entry.object.id),
      size: entry.size ? roundVec(entry.size) : null,
      center: entry.center ? roundVec(entry.center) : null,
    })),
    hasMore: query.offset + page.length < found.length,
  };
  if (result.hasMore) result.nextOffset = query.offset + page.length;
  return result;
}
