import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from "three";

/**
 * The imported models the golden histories refer to. A history stores that a model was imported, not the model, so a
 * fixture names one of these and this builds it, the same way every time.
 */
export const MODEL_RECIPES = ["robot", "plain"] as const;
export type ModelRecipe = (typeof MODEL_RECIPES)[number];

function part(name: string, at: readonly [number, number, number]): Mesh {
  const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial());
  mesh.name = name;
  mesh.position.fromArray([...at]);
  return mesh;
}

/** `robot` has three named parts, one of which (Cutter) overlaps a corner of a unit box at the origin. `plain` has two unnamed parts. */
export function buildModel(recipe: string): Group {
  const model = new Group();
  if (recipe === "robot") {
    model.name = "robot.glb";
    model.add(part("Head", [5, 0, 0]), part("Cutter", [0.5, 0.5, 0.5]), part("Arm", [9, 0, 0]));
    return model;
  }
  if (recipe === "plain") {
    model.name = "plain.glb";
    model.add(part("", [0, 0, 0]), part("", [3, 0, 0]));
    return model;
  }
  throw new Error(`Unknown model recipe "${recipe}"`);
}
