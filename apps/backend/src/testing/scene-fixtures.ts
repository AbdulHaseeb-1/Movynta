import { editorContextSchema, type EditorContext, type EditorObject } from "@movynta/editor-protocol";

type Box = readonly [number, number, number];

interface ObjectSpec {
  readonly id: string;
  readonly name?: string;
  readonly type?: EditorObject["type"];
  readonly parentId?: string | null;
  /** World center. */
  readonly at?: Box;
  /** World size. Leave out for an object with no geometry. */
  readonly size?: Box | null;
  readonly visible?: boolean;
}

/** One object of a test scene, with world bounds from a center and a size. */
export function sceneObject(spec: ObjectSpec): EditorObject {
  const at = spec.at ?? [0, 0, 0];
  const size = spec.size === undefined ? [1, 1, 1] : spec.size;
  return {
    id: spec.id,
    name: spec.name ?? spec.id,
    type: spec.type ?? "mesh",
    parentId: spec.parentId ?? null,
    transform: { position: [...at], rotation: [0, 0, 0], scale: [1, 1, 1] },
    visible: spec.visible ?? true,
    worldBounds:
      size === null
        ? null
        : {
            min: [at[0] - size[0] / 2, at[1] - size[1] / 2, at[2] - size[2] / 2],
            max: [at[0] + size[0] / 2, at[1] + size[1] / 2, at[2] + size[2] / 2],
          },
  };
}

/** A valid editor snapshot around the given objects. */
export function sceneOf(
  objects: readonly EditorObject[],
  extra: { selected?: string[]; revision?: number } = {},
): EditorContext {
  return editorContextSchema.parse({
    projectId: "fixture",
    revision: extra.revision ?? 7,
    activeSceneName: "Main",
    selectedObjectIds: extra.selected ?? [],
    objects,
  });
}

/** Options for the building fixture: how many floors and columns, and how far apart they are. */
export interface BuildingOptions {
  readonly floors: number;
  readonly columns: number;
  /** Distance between window centers along x. */
  readonly spacingX?: number;
  /** Distance between floors. */
  readonly spacingY?: number;
  /** Add a frame and a pane inside each window. */
  readonly parts?: boolean;
}

/**
 * A building: a root group, a roof, and a facade of floors by columns windows. Each window is a group of its own,
 * holding a frame and a pane, so the scene has several objects per idea.
 */
export function buildingObjects(options: BuildingOptions): EditorObject[] {
  const spacingX = options.spacingX ?? 1.2;
  const spacingY = options.spacingY ?? 3;
  const parts = options.parts ?? true;
  const objects: EditorObject[] = [
    sceneObject({ id: "building", name: "Building", type: "empty", size: null }),
    sceneObject({
      id: "walls",
      name: "Walls",
      parentId: "building",
      at: [0, 0, 0],
      size: [options.columns * spacingX + 2, options.floors * spacingY, 10],
    }),
    sceneObject({
      id: "roof",
      name: "Roof",
      parentId: "building",
      at: [0, (options.floors * spacingY) / 2 + 0.5, 0],
      size: [options.columns * spacingX + 3, 1, 11],
    }),
    sceneObject({ id: "facade", name: "Facade", type: "empty", parentId: "building", size: null }),
  ];
  for (let floor = 0; floor < options.floors; floor += 1) {
    for (let column = 0; column < options.columns; column += 1) {
      const id = `window_${floor}_${column}`;
      const at: Box = [column * spacingX, floor * spacingY, 5];
      objects.push(
        sceneObject({
          id,
          name: `Window.${String(floor * options.columns + column + 1).padStart(3, "0")}`,
          type: "empty",
          parentId: "facade",
          at,
          size: parts ? [1, 1.4, 0.2] : [1, 1.4, 0.2],
        }),
      );
      if (parts) {
        objects.push(sceneObject({ id: `${id}_frame`, name: "Frame", parentId: id, at, size: [1, 1.4, 0.2] }));
        objects.push(sceneObject({ id: `${id}_pane`, name: "Pane", parentId: id, at, size: [0.8, 1.2, 0.05] }));
      }
    }
  }
  return objects;
}
