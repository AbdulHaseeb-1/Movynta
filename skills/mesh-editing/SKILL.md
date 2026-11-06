---
name: mesh-editing
version: 1.8.0
description: Inspects mesh geometry and edits transforms, bevels, subdivision surfaces, booleans, plane cuts, deletion, replacements, and cleanup through validated proposals with automatic application.
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
  - cut
  - bisect
when_to_use:
  - The user asks to move, scale, rotate, extrude, cut, boolean, replace, or clean up existing geometry.
  - The user asks to change the topology of an object that already exists.
required_inputs:
  - The objects to change, identified from the editor context.
  - The intended change (for example: scale by 1.2, replace with a sphere).
tools:
  - editor.get_context
  - editor.inspect_mesh
  - editor.inspect_materials
  - editor.measure
  - editor.plan_placement
  - editor.plan_duplicates
  - viewport.capture
  - modeling.generate_commands
  - modeling.propose_generated
  - editor.propose_commands
  - editor.apply_proposal
  - validation.check_scene
validation:
  - Each target object id exists in the latest editor context.
  - Transforms use finite numbers, and scale values are positive.
  - Replacing geometry is an explicit destructive command and applies automatically through a proposal.
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

For repeated layouts or mathematical placement, calculate command arrays with `modeling.generate_commands` using synchronous JavaScript and the supplied `scene` snapshot. Submit the returned commands with `expectedRevision` equal to `sourceRevision`. If the scene changes, recalculate before proposing again. Programs can return a bounded `geometry.create_mesh` command with vertices and indexed polygon faces. Appearance changes use separate material proposals after inspection.

For larger generated arrays, `modeling.propose_generated` computes and stores a normal proposal without echoing all commands to the model. Pass an optional mesh inspection to expose `mesh.faceMatches.ids` inside the program. Check `mesh.faceMatches.hasMore` before using a query page. Preview the proposal, then call `editor.apply_proposal` to apply it automatically.

Use `geometry.create_primitive` options for exact local-space dimensions and mesh density. Cylinders accept distinct `radiusTop` and `radiusBottom`, height, radial segments and height segments. Box, plane, sphere, cone and torus accept their applicable dimensions and segment counts. Tetrahedron, octahedron and icosahedron accept radius and detail. Use the size-based defaults for omitted values.

Use `editor.inspect_mesh` with `faceQuery` to find faces by local-space normal direction and/or center bounds. Set `includeSamples: false` when only face IDs are needed. Page the result with `faceQuery.offset` and `faceQuery.limit`, and use the returned inspection view and revision for any edit.

For surface editing, first call `editor.inspect_mesh` with objectId. Imported groups return parts; choose a meshPath and inspect that mesh. Paths are given by part name ("Body", "Arm#1" for the second part named Arm) where a part has one, and by child index where it does not; use them exactly as returned, and write a boolean operand path the same way as the path of the mesh it cuts. Set `view` to `base` for base-cage component IDs or `evaluated` for the displayed mesh (the default). Use offset/limit for local-space vertex, edge and polygon samples. Indices refer to the complete topology. Inspect bounds, counts and boundary/winding defects before choosing an operation.

Use `geometry.bevel` with a small positive mesh-local width, profile `circular`, and 3–4 segments for rounded corners. The angle threshold protects shallow creases and coplanar edges are skipped. Use `geometry.subdivide` with 1–3 levels and method `catmull-clark`, `linear`, or `loop`. Inspect the current stack and use `geometry.set_modifiers` to reorder, update or remove entries. Preserve existing IDs and parameters.

Create and position a closed solid cutter first. Append the live cut with `geometry.boolean` and name the cutter with `operandObjectId` and optional `operandMeshPath`. Choose `difference`, `union`, or `intersect`. Use `editor.inspect_mesh` and its `stats.materialSlots` count to verify the zero-based `cutMaterialIndex`. To round the result, place `geometry.bevel` after the cut in the same modifier batch. The cutter remains in the scene. Open surfaces, skinned meshes, morph targets, self operands and cycles are rejected.

Use `geometry.subdivide_faces` to split only selected faces of the base cage. `ids` are face indices from `editor.inspect_mesh`, and the rest of the mesh is unchanged. Choose it when the user asks to subdivide part of an object; `geometry.subdivide` always affects the whole object. Disable enabled modifiers first, and use a strict revision.

Use `geometry.extrude` to grow a region of the base cage. `kind` is `face`, `edge` or `vertex`. IDs are face indices, canonical edge keys `min_max`, or vertex indices. Supply either a nonzero mesh-local `offset` vector or, for faces, a signed mesh-local `normalDistance`. The normal mode translates the cap together along the area-weighted region normal. For enabled modifiers, confirm `editor.inspect_mesh` returned `view: base`, choose IDs from that result, set `componentView: base`, and propose with the inspection revision as `expectedRevision`. The modifier stack is evaluated again on the result. Never use evaluated picks as base IDs. Use a component edit batch of at most 20 commands.

After proposing a geometry change, call `viewport.capture` with the pending `proposalId` to inspect the result before applying. Capture the live mesh separately with matching cameras for a before-and-after comparison. If the candidate fails validation or looks wrong, supersede the proposal with a corrected one.

For face picks on evaluated geometry, `editor.get_context` may return `designFocus.componentSelection.baseFaceIds` when all selected faces have a known source. A mapped base edit affects entire base faces, including display fragments outside the selection. Use those mapped IDs with `componentView: base` and the context revision. If the mapping is missing, inspect the base cage instead.

Shape a face cap with `capScale` and `twistDegrees` around the direction of extrusion. Set `closeOpenSurface: true` with `normalDistance` and all faces of an open planar sheet when the user wants a closed solid. For adjustable extrusion, put one `kind: extrusion` entry first in `geometry.set_modifiers`. Use the base inspection's `baseKey`, face IDs and revision, then preserve the remaining stack. The entry accepts `normalDistance` and the same shaping and closing options. Hole fill and base extrusions that preserve its anchored face polygons can retain the modifier. Remove it before other base edits.

Use `normalMode: vertex` for connected extrusion along the selected surface's vertex normals. Use `normalMode: individual` for separate face caps. Adjacent coplanar faces must use a connected mode. `steps` repeats a face extrusion up to 16 times. Use `capScaleXY` for separate in-plane scales and `capRotationDegrees` for mesh-local XYZ tilt. A live edge or paired-vertex extrusion uses `componentKind` and `offset`.
Use `geometry.transform_faces` to move, scale or rotate faces by editing their shared vertices. Pass `transform.position` as a delta, rotation in XYZ radians and scale as per-axis factors. Choose `space: local` or `space: world`. It shares the same automatic application and component batch rules as extrusion.

For direct vertex or edge transforms, use `geometry.transform_components`. Inspect `view: base` first, then pass `kind: vertex` or `edge`, unique base IDs, `componentView: base`, and the inspection revision as `expectedRevision`. Edge IDs use canonical smaller_larger endpoint IDs and must name actual edges. Transform fields use the same conventions as face transforms. An optional `pivot` gives an absolute point in the chosen space; otherwise the centroid of the unique selected vertices is used. Scale is applied before rotation, then translation. Enabled modifiers reevaluate; live face extrusion anchors must remain unchanged. Never treat evaluated vertex/edge selection IDs as base IDs. Reinspect after application.

For `geometry.merge_vertices`, supply at least two unique base vertex IDs and mode `center`, `first`, or `last` (the order in `ids`). The operation interpolates attributes per surviving face and rejects pinching, collapse, non-manifold results and coincident faces. `geometry.dissolve_edges` removes internal edges only across coplanar faces with the same material and continuous affine attributes. Select every internal edge in a region; regions with holes, branching boundaries, UV seams, non-affine color/UV/deformation detail or bent faces are rejected.

`geometry.loop_cut` follows opposite edges through a quad strip from one canonical `edge`. Use `cuts` 1–16, default 1. For one cut, `factor` strictly between 0 and 1 offsets it along the seed edge from its lower-numbered vertex. Multiple cuts use even spacing with factor 0.5. The ring stops at open boundaries; nonquad faces, crossing rings and inconsistent orientation are rejected. New vertex and corner attributes interpolate independently, preserving seams.

Cut a mesh with `geometry.bisect`, the plane cut, whenever the request is a straight cut: "cut it in half", "slice off the top", "add an edge loop across the wall", "split at x = 0.3". Name the plane as `{ axis: "y", offset: 1.2 }` or as `{ point, normal }`; `normal` points to the `positive` side. Use `space: "world"` for a height or position the user stated in the scene, and `space: "local"` (default) for coordinates read from `editor.inspect_mesh`. Read `localBounds` or the world bounds first so the plane falls inside the mesh; if the plane misses, the error reports the distance range of the mesh from the plane, so choose a value inside it. To remove a side, set `keep` to `positive` or `negative`, and set `fill: true` so the opening is capped and the solid stays closed; leave `fill` off for an open shell or when the cut passes through a ring (nested outlines are refused). Add `ids` (base face IDs, for example from a `faceQuery`) to cut only part of the mesh. Cut faces must be flat; if a face is reported as not cuttable, run `geometry.triangulate_faces` on it and cut again. Use `geometry.loop_cut` only for rings of quads, and `geometry.knife_chord` or `geometry.knife_path` only to join known boundary points; do not predict IDs for several knife segments when one plane does the job. After a cut, face IDs shift up (pieces are consecutive) and new vertices are last, so inspect again before the next edit.

Use `geometry.delete_components` with `kind` `face`, `edge` or `vertex` to take geometry away: faces go alone, an edge or vertex takes every face touching it. It keeps the order of what remains and may open a closed mesh; follow it with `geometry.fill_hole` (boundary edge IDs from a new inspection) when the object must stay closed. Deleting everything is refused (delete the object with `scene.delete_object`), as is leaving faces that touch only at a corner. Use `geometry.flip_normals` to make a surface face the other way (omit `ids` for every surface, or name one face per surface to flip; a surface flips as a whole), for example a one-sided layer plane that faces away from the camera. Use `geometry.triangulate_faces` to split polygons into triangles (omit `ids` for all).

Merge, dissolve, loop cut, bisect, delete and triangulate each require a single-command proposal, disabled enabled modifiers, and removal of live extrusion. IDs change, so inspect again after applying. All use base IDs and the inspection's expectedRevision. `geometry.slide_edges` preserves IDs: provide selected edge `ids`, `factor` strictly between 0 and 1, and exactly one `rails` entry `{vertex,toward}` per unique selected endpoint. A rail is an existing edge to an unselected neighbor. Select the other rail for the opposite direction. Sliding moves geometry in mesh-local space and keeps UV/corner attributes attached; UV correction is not included. All four operations use automatic application and saved undo/redo.

Use `geometry.fill_hole` to close a single opening whose boundary has a simple projection using 3–256 canonical base boundary-edge IDs. With enabled modifiers, pass `componentView: base` and `expectedRevision` from base inspection.

Concave and open manifold meshes are supported; open boundaries remain open. UV seams, material assignments, vertex colors, skin weights and morph targets are preserved/interpolated. New bevel strips and corner patches use adjacent materials and interpolated UVs; they do not create an automatic texture unwrap. Both geometric and stack edits apply automatically, use strict scene revisions, and must be submitted separately from creation/transforms (at most 20 commands). Reduce overlapping widths and excessive refinement or explain unsupported topology rather than replacing the model. Users can edit the active mesh part in the manual Modifiers panel; a crease editor is not implemented.


## Material controls

Read `editor.inspect_materials` for the target mesh path. It returns paged slot properties without parsing topology, so it works on dense or skinned imported meshes. `material.set_properties` edits Standard/Physical properties while retaining imported maps and physical settings. Use sRGB #RRGGBB color/emissive values, roughness/metalness/opacity in 0–1, emissiveIntensity in 0–100, name, side (front/back/double), and optional depthWrite. Setting opacity enables transparent below 1; it does not change depthWrite automatically.

`material.add_slot` appends a new Standard material at slot equal to materialSlotCount. It preserves current face appearance and does not assign the new slot. `material.replace_slot` intentionally replaces an existing shader and its maps/settings with a new Standard material; use only when replacement reflects user intent. Property/slot commands use a separate batch of at most 20 commands and require expectedRevision from inspection.

After creating a slot, inspect the base cage and use `material.assign` with existing slot and unique base face ids, or omit ids for all faces. Pass the inspection revision. Assignment uses the component-edit pipeline and reevaluates enabled modifiers. Material edits apply automatically, preview through solid viewport captures, persist in history, and support undo/redo. Texture import/creation, UV authoring and node shaders remain pending.


## Duplication and editable repetition

Use `editor.plan_duplicates` for independent hierarchy copies or a linear object array. Set sourceId, additional copies (1–63), parent/world offset per copy, and optional root name. Propose its one scene.duplicate_hierarchy command at sourceRevision. Every registered descendant receives a fresh ID; imported inner parts retain names and paths. Roots retain the source parent and each object retains its collection membership. Geometry, material instances, modifier cages and skeletons are independent; texture assets stay shared. Internal Boolean cutters remap within each copy, while external cutters remain linked and reevaluate. Limits are 2000 total objects and the scene geometry memory budget. Names are numbered among siblings, including unnamed-root fallback labels.

Use geometry.set_modifiers for live mesh arrays and symmetry. An array entry has id, kind array, enabled, total count (1–64 including source), and nonzero local offset per instance. Copies remain separate islands; no merging/Boolean union is implied. A mirror entry has id, kind mirror, enabled, axis x/y/z, local plane origin (default 0), bisect (default true), keepSide positive/negative (default positive), and mergeDistance 0–1 (default 1e-6). Inspect local bounds to choose the plane and retained side. Crossing convex faces bisect and interpolate attributes; reflected winding reverses and normals/tangents recompute. Seam vertices weld, and source caps on the plane are removed. Concave intersected faces, unbisected crossing input, open faces on the plane and invalid topology are rejected. Live mirror regenerates after base edits; it does not constrain interactive vertex movement.

Preserve existing stack entries and order them deliberately. Both entries can be edited, reordered, disabled or removed through the Modifiers panel or assistant commands. Output growth is bounded, and enabled Boolean dependencies reevaluate. Skin/morph modifier evaluation is unsupported; duplicate the hierarchy instead. Base/source face mappings remain available on evaluated copies: inspect the base and use its revision and IDs for component edits. Preview, apply automatically, measure and inspect results; stack and duplication edits persist and support undo/redo.
