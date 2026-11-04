import { describe, expect, it } from "vitest";
import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from "three";
import { listedPath, partsOf, pathFrom, pathValue, type OperandChoice } from "./meshParts";

const part = (name: string) => {
  const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial());
  mesh.name = name;
  return mesh;
};

function model(): Group {
  const root = new Group();
  const body = new Group();
  body.name = "Body";
  body.add(part("Arm"), part("Arm"), part(""));
  root.add(part("Head"), body);
  return root;
}
function choice(root: Group): OperandChoice {
  return { objectId: "model", name: "model", parts: partsOf(root), root };
}

describe("the meshes of an object, as the list offers them", () => {
  it("names each by its path, with names where they exist and an index where they do not", () => {
    expect(partsOf(model()).map((entry) => entry.path)).toEqual([["Head"], ["Body", "Arm"], ["Body", "Arm#1"], ["Body", 2]]);
  });

  it("lists the root itself, with the empty path, when it is a mesh", () => {
    const mesh = part("Solo");
    expect(partsOf(mesh).map((entry) => entry.path)).toEqual([[]]);
  });

  it("lists nothing for no object", () => {
    expect(partsOf(undefined)).toEqual([]);
  });
});

describe("a stored path in the list", () => {
  it("shows a path stored as indexes as the part it leads to, so the right choice is marked", () => {
    const root = model();
    const operand = choice(root);
    // Written before names existed: the second Arm, by index.
    expect(listedPath(operand, [1, 1])).toEqual(["Body", "Arm#1"]);
    expect(pathValue(listedPath(operand, [1, 1]))).toBe(pathValue(["Body", "Arm#1"]));
  });

  it("shows a path stored by name as it is", () => {
    expect(listedPath(choice(model()), ["Body", "Arm#1"])).toEqual(["Body", "Arm#1"]);
  });

  it("leaves a path that leads to no listed part as it was, so nothing else is shown as chosen", () => {
    expect(listedPath(choice(model()), ["Leg"])).toEqual(["Leg"]);
    expect(listedPath(undefined, [3])).toEqual([3]);
    expect(listedPath({ objectId: "gone", name: "gone", parts: [] }, [0])).toEqual([0]);
  });
});

describe("a path as the text of a choice", () => {
  it("goes there and back for any path, whatever characters a name has", () => {
    for (const path of [[], ["Head"], ["Body", "Arm#1"], [1, 2], ['a "quoted", name', "x/y", "päth ✓"], ["Body", 2]]) {
      expect(pathFrom(pathValue(path))).toEqual(path);
    }
  });

  it("tells two different parts apart even when their names look alike", () => {
    expect(pathValue(["a,b"])).not.toBe(pathValue(["a", "b"]));
    expect(pathValue([1, 2])).not.toBe(pathValue(["1,2"]));
  });

  it("reads text that is not a path as the empty path, never as something else", () => {
    for (const text of ["", "not json", "{}", "[null]", "[-1]", '[""]', "1,2"]) expect(pathFrom(text)).toEqual([]);
  });
});
