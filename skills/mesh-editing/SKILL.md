---
name: mesh-editing
version: 1.3.0
description: Inspects mesh geometry and edits transforms, bevels, subdivision surfaces, booleans, replacements, and cleanup through approved commands.
dimensions:
  - 2d
  - 2.5d
  - 3d
tags:
  - mesh
  - edit
  - transform
  - topology
  - bevel
  - subdivision
  - boolean
when_to_use:
  - The user asks to move, scale, rotate, extrude, cut, boolean, replace, or clean up existing geometry.
  - The user asks to change the topology of an object that already exists.
required_inputs:
  - The objects to change, identified from the editor context.
  - The intended change (for example: scale by 1.2, replace with a sphere).
tools:
  - editor.get_context
  - editor.inspect_mesh
  - viewport.capture
  - modeling.generate_commands
  - modeling.propose_generated
  - editor.propose_commands
  - editor.apply_proposal
  - validation.check_scene
validation:
  - Each target object id exists in the latest editor context.
  - Transforms use finite numbers, and scale values are positive.
  - Replacing geometry is an explicit destructive command and is shown for approval.
error_handling:
  - If a target object is missing, stop and ask the user which object to change.
  - If the user rejects a destructive proposal, do not retry it. Propose a non-destructive alternative instead.
  - Report revision conflicts, read the current context, and recalculate before proposing corrected commands.
---

# Mesh editing workflow

1. Call `editor.get_context` and confirm every target object exists.
2. Describe the change in plain language, then build the smallest set of commands that achieves it.
3. Use `scene.transform_object` to set position, rotation, or scale, and `scene.move_object` to move an object by a distance from where it is now. Use `geometry.create_primitive` with `replaceExisting` only when the user asked to replace geometry.
4. Submit with `editor.propose_commands` and apply with `editor.apply_proposal`.
5. Validate with `validation.check_scene` and summarise what changed.

For repeated layouts or mathematical placement, calculate command arrays with `modeling.generate_commands` using synchronous JavaScript and the supplied `scene` snapshot. Submit the returned commands with `expectedRevision` equal to `sourceRevision`. If the scene changes, recalculate before proposing again. Programs can return a bounded `geometry.create_mesh` command with vertices and indexed polygon faces. Material operations remain unavailable.

For larger generated arrays, `modeling.propose_generated` computes and stores a normal proposal without echoing all commands to the model. Pass an optional mesh inspection to expose `mesh.faceMatches.ids` inside the program. Check `mesh.faceMatches.hasMore` before using a query page. Preview the proposal, then call `editor.apply_proposal` to apply it or request approval.

Use `geometry.create_primitive` options for exact local-space dimensions and mesh density. Cylinders accept distinct `radiusTop` and `radiusBottom`, height, radial segments and height segments. Box, plane, sphere, cone and torus accept their applicable dimensions and segment counts. Tetrahedron, octahedron and icosahedron accept radius and detail. Use the size-based defaults for omitted values.

Use `editor.inspect_mesh` with `faceQuery` to find faces by local-space normal direction and/or center bounds. Set `includeSamples: false` when only face IDs are needed. Page the result with `faceQuery.offset` and `faceQuery.limit`, and use the returned inspection view and revision for any edit.

For surface editing, first call `editor.inspect_mesh` with objectId. Imported groups return parts; choose a meshPath and inspect that mesh. Set `view` to `base` for base-cage component IDs or `evaluated` for the displayed mesh (the default). Use offset/limit for local-space vertex, edge and polygon samples. Indices refer to the complete topology. Inspect bounds, counts and boundary/winding defects before choosing an operation.

Use `geometry.bevel` with a small positive mesh-local width, profile `circular`, and 3–4 segments for rounded corners. The angle threshold protects shallow creases and coplanar edges are skipped. Use `geometry.subdivide` with 1–3 levels and method `catmull-clark`, `linear`, or `loop`. Inspect the current stack and use `geometry.set_modifiers` to reorder, update or remove entries. Preserve existing IDs and parameters.

Create and position a closed solid cutter first. Append the live cut with `geometry.boolean` and name the cutter with `operandObjectId` and optional `operandMeshPath`. Choose `difference`, `union`, or `intersect`. Use `editor.inspect_mesh` and its `stats.materialSlots` count to verify the zero-based `cutMaterialIndex`. To round the result, place `geometry.bevel` after the cut in the same modifier batch. The cutter remains in the scene. Open surfaces, skinned meshes, morph targets, self operands and cycles are rejected.

Use `geometry.subdivide_faces` to split only selected faces of the base cage. `ids` are face indices from `editor.inspect_mesh`, and the rest of the mesh is unchanged. Choose it when the user asks to subdivide part of an object; `geometry.subdivide` always affects the whole object. Disable enabled modifiers first, and expect approval.

Use `geometry.extrude` to grow a region of the base cage. `kind` is `face`, `edge` or `vertex`. IDs are face indices, canonical edge keys `min_max`, or vertex indices. Supply either a nonzero mesh-local `offset` vector or, for faces, a signed mesh-local `normalDistance`. The normal mode translates the cap together along the area-weighted region normal. For enabled modifiers, confirm `editor.inspect_mesh` returned `view: base`, choose IDs from that result, set `componentView: base`, and propose with the inspection revision as `expectedRevision`. The modifier stack is evaluated again on the result. Never use evaluated picks as base IDs. Use a component edit batch of at most 20 commands.

After proposing a geometry change, call `viewport.capture` with the pending `proposalId` to inspect the result before requesting approval. Capture the live mesh separately with matching cameras for a before-and-after comparison. If the candidate fails validation or looks wrong, supersede the proposal with a corrected one.

For face picks on evaluated geometry, `editor.get_context` may return `designFocus.componentSelection.baseFaceIds` when all selected faces have a known source. A mapped base edit affects entire base faces, including display fragments outside the selection. Use those mapped IDs with `componentView: base` and the context revision. If the mapping is missing, inspect the base cage instead.

Shape a face cap with `capScale` and `twistDegrees` around the direction of extrusion. Set `closeOpenSurface: true` with `normalDistance` and all faces of an open planar sheet when the user wants a closed solid. For adjustable extrusion, put one `kind: extrusion` entry first in `geometry.set_modifiers`. Use the base inspection's `baseKey`, face IDs and revision, then preserve the remaining stack. The entry accepts `normalDistance` and the same shaping and closing options. Hole fill and base extrusions that preserve its anchored face polygons can retain the modifier. Remove it before other base edits.

Use `normalMode: vertex` for connected extrusion along the selected surface's vertex normals. Use `normalMode: individual` for separate face caps. Adjacent coplanar faces must use a connected mode. `steps` repeats a face extrusion up to 16 times. Use `capScaleXY` for separate in-plane scales and `capRotationDegrees` for mesh-local XYZ tilt. A live edge or paired-vertex extrusion uses `componentKind` and `offset`.
Use `geometry.transform_faces` to move, scale or rotate faces by editing their shared vertices. Pass `transform.position` as a delta, rotation in XYZ radians and scale as per-axis factors. Choose `space: local` or `space: world`. It shares the same approval and component batch rules as extrusion.

Use `geometry.fill_hole` to close a single opening whose boundary has a simple projection using 3–256 canonical base boundary-edge IDs. With enabled modifiers, pass `componentView: base` and `expectedRevision` from base inspection.

Concave and open manifold meshes are supported; open boundaries remain open. UV seams, material assignments, vertex colors, skin weights and morph targets are preserved/interpolated. New bevel strips and corner patches use adjacent materials and interpolated UVs; they do not create an automatic texture unwrap. Both geometric and stack edits require approval, use strict scene revisions, and must be submitted separately from creation/transforms (at most 20 commands). Reduce overlapping widths and excessive refinement or explain unsupported topology rather than replacing the model. Users can edit the active mesh part in the manual Modifiers panel; a crease editor is not implemented.
