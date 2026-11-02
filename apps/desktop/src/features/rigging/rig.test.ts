import { describe, expect, it } from "vitest";
import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from "three";
import { boneAt, boneLabel, isSkinnedMesh, poseOf, rigOf, type Rig } from "./rig";
import { prepareRig } from "./prepareRig";
import { buildRiggedModel } from "./rigFixture";

function rigFor(model: Group): Rig {
  const rig = rigOf(model);
  if (!rig) throw new Error("expected the model to have a rig");
  return rig;
}

describe("finding a rig", () => {
  it("has none for a model without bones, and says so only once", () => {
    const plain = new Group();
    plain.add(new Mesh(new BoxGeometry(), new MeshStandardMaterial()));
    expect(rigOf(plain)).toBeUndefined();
    expect(rigOf(plain)).toBeUndefined();
  });

  it("lists the bones parents first, in the order the file gives them, with their hierarchy", () => {
    // The fixture hangs bones 1 and 2 from 0, 3 and 4 from 1, 5 and 6 from 2.
    const rig = rigFor(buildRiggedModel(7));
    expect(rig.bones.map((bone) => bone.name)).toEqual([
      "bone_0",
      "bone_1",
      "bone_3",
      "bone_4",
      "bone_2",
      "bone_5",
      "bone_6",
    ]);
    expect(Array.from(rig.parents)).toEqual([-1, 0, 1, 1, 0, 4, 4]);
    expect(Array.from(rig.depths)).toEqual([0, 1, 2, 2, 1, 2, 2]);
  });

  it("remembers the rig, so asking again costs nothing and gives the same bones", () => {
    const model = buildRiggedModel(4);
    expect(rigOf(model)).toBe(rigOf(model));
  });

  it("finds a bone by its position, and refuses a position that is not a bone", () => {
    const rig = rigFor(buildRiggedModel(3));
    expect(boneAt(rig, 2)).toBe(rig.bones[2]);
    expect(boneAt(rig, 3)).toBeUndefined();
    expect(boneAt(rig, -1)).toBeUndefined();
    expect(boneAt(rig, 0.5)).toBeUndefined();
  });

  it("names a bone by the file's name, or by its number when it has none", () => {
    const rig = rigFor(buildRiggedModel(2));
    expect(boneLabel(rig, 1)).toBe("bone_1");
    const second = boneAt(rig, 1);
    if (second) second.name = "";
    expect(boneLabel(rig, 1)).toBe("Bone 2");
  });
});

describe("the pose a rig starts in", () => {
  it("is the file's pose, kept when bones are moved and when the rig is found again in a copy of the model", () => {
    const model = buildRiggedModel(3);
    const rig = prepareRig(model);
    const bone = rig ? boneAt(rig, 1) : undefined;
    if (!rig || !bone) throw new Error("expected a rig");
    const start = poseOf(bone);
    bone.rotation.z = 1;
    bone.position.x = 9;

    // The scene replaces a model with a copy that holds the same bones.
    const copy = new Group();
    for (const child of [...model.children]) copy.add(child);
    const found = rigFor(copy);
    expect(found).not.toBe(rig);
    expect(found.rest[1]).toEqual(start);
    expect(poseOf(bone)).not.toEqual(start);
  });
});

describe("preparing a rigged model", () => {
  it("stops skinned meshes from being culled, as their bounds are measured from one pose", () => {
    const model = buildRiggedModel(2);
    const skinned = model.children.filter(isSkinnedMesh);
    expect(skinned).toHaveLength(1);
    expect(skinned[0]?.frustumCulled).toBe(true);
    prepareRig(model);
    expect(skinned[0]?.frustumCulled).toBe(false);
  });

  it("does nothing for a model without bones", () => {
    expect(prepareRig(new Group())).toBeUndefined();
  });
});
