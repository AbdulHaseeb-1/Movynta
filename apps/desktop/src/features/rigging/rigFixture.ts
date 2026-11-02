import {
  Bone,
  BoxGeometry,
  Float32BufferAttribute,
  Group,
  MeshStandardMaterial,
  Skeleton,
  SkinnedMesh,
  Uint16BufferAttribute,
} from "three";

/**
 * A rigged model for tests and benchmarks: `boneCount` bones in a binary tree (bone `i` hangs from
 * bone `(i - 1) >> 1`), each half a unit above its parent and to its left or right by half as much
 * at each level down, so no two joints share a place. A box is skinned to the first bone. The bones
 * are the children of the model, next to the mesh, as glTF files list them. `skinnedTo` picks the bone
 * (by the order they are made in, which is also the order of the rig) that moves the box.
 */
export function buildRiggedModel(boneCount: number, skinnedTo = 0): Group {
  const bones: Bone[] = [];
  for (let index = 0; index < boneCount; index += 1) {
    const bone = new Bone();
    bone.name = `bone_${index}`;
    if (index > 0) {
      const level = Math.floor(Math.log2(index + 1));
      bone.position.set((index % 2 === 1 ? 1 : -1) * 0.5 ** level, 0.5, 0);
      bones[(index - 1) >> 1]?.add(bone);
    }
    bones.push(bone);
  }

  const geometry = new BoxGeometry(1, 1, 1);
  const vertices = geometry.getAttribute("position").count;
  const indices = new Uint16Array(vertices * 4);
  for (let vertex = 0; vertex < vertices; vertex += 1) indices[vertex * 4] = skinnedTo;
  geometry.setAttribute("skinIndex", new Uint16BufferAttribute(indices, 4));
  const weights = new Float32Array(vertices * 4);
  for (let vertex = 0; vertex < vertices; vertex += 1) weights[vertex * 4] = 1;
  geometry.setAttribute("skinWeight", new Float32BufferAttribute(weights, 4));

  const mesh = new SkinnedMesh(geometry, new MeshStandardMaterial());
  const model = new Group();
  model.name = "rigged";
  const root = bones[0];
  if (root) model.add(root);
  model.add(mesh);
  model.updateMatrixWorld(true);
  mesh.bind(new Skeleton(bones));
  return model;
}
