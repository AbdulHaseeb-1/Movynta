# Skinned stickman body

The lab draws the character as one `THREE.SkinnedMesh` driven by a bone tree that mirrors the simulation rig (same 23
names, same parents). Nothing in `src/engine/` knows about rendering.

## Pipeline (all pure TypeScript except the last step)

1. `bodyPrimitives.ts`: the figure as strokes (round tubes) between joints of a relaxed A-pose bind pose. Same stroke
   width and head as the earlier capsule figure. Arms and legs are slightly apart in the bind pose so they never fuse
   with the torso or each other.
2. `signedDistance.ts`: signed distance to the strokes. Strokes of one chain (spine, one arm, one leg) join with an exact
   union, so a straight limb has no bulges at its joints; separate chains (shoulder bar to torso, thigh to pelvis, head
   to neck) are filleted into each other with a polynomial smooth minimum.
3. `surfaceNets.ts`: meshes the distance field with surface nets and snaps every vertex onto the exact surface; vertex
   normals are the field gradient, so shading is smooth everywhere. The result is one closed, connected surface.
4. `skinWeights.ts`: each surface point follows its stroke's bone and blends toward the bone across the nearest joint
   within `blendHalfWidth`, reaching exactly 50/50 at the joint. A few Laplacian passes over the mesh remove steps where
   strokes meet. At most four influences per vertex, normalized to 1.
5. `jointCorrectives.ts` and `StickmanSkin.ts`: GPU skinning plus a corrective step in the vertex shader.

## Corrective deformation

Blending two bones 50/50 shrinks the tube at a bent joint to `cos(angle / 2)` of its radius in the bend plane (the
"collapsed elbow") and leaves it unchanged perpendicular to the bend. For elbows, knees, shoulders and hips, vertices
near the joint are pushed outward along the in-plane part of their skinned normal by `gain * (1 - cos(angle / 2))` of
the stroke radius, scaled by how much both bones influence the vertex. The bend angle and axis come from the bones'
relative rotation each frame. `StickmanSkin.setCorrectives(false)` switches it off to compare with plain linear skinning,
and `StickmanSkin.skinnedVertex` evaluates the same math on the CPU for tests.

## Cost

The mesh is built once per character config (about 18 000 vertices, 36 000 triangles, a few hundred milliseconds) and
cached. Per frame the CPU only sets 23 bone transforms and 8 joint angles.

## Known limits

* The shadow-casting depth pass uses plain linear skinning (the corrective is only in the main material), so shadows at
  extreme bends differ from the visible surface by up to a few millimetres.
* The stroke width is fixed in the mesh. Changing `STROKE_RADIUS` rebuilds the geometry; it is not a runtime control.
