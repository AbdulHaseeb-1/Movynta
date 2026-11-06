# Assistant controls implementation

Requested scope: implement the seven capability gaps in sequence, with automatic proposal application.

## Implemented

- Automatic application: all assistant editor proposals, including destructive changes and large batches, bypass approval prompts. Unknown proposals fail lookup. Validation, ownership, previews, strict revisions, transactions, and undo/redo remain active. Generic approval infrastructure remains for legacy data; integration tests explicitly inject a test-only policy to exercise it.
- Precision placement: `editor.plan_placement` plans evaluated bounds alignment, calibrated positive/negative axis gaps, equal centers/equal gaps distribution, and revision-bound world-point snapping. Plans use existing move commands with a strict source revision and parent-coordinate conversion. Bounds alignment does not rotate faces or guarantee surface contact. Arbitrary surface orientation and collision-aware placement remain future precision work.

- Direct vertex/edge transforms are implemented as `geometry.transform_components`: local/world move, rotate and scale, centroid or explicit pivot, inspected base IDs, strict proposal revisions, attribute-preserving output, modifier reevaluation, and saved undo/redo. The additional topology operations are described below.

- Merge, dissolve, explicit-rail edge slide and quad-ring loop cuts are implemented. They use inspected base IDs, strict proposal revisions, automatic application and saved history. Dissolve is limited to coplanar regions with continuous affine attributes. Loop cuts require quad strips. Sliding preserves attached UVs without UV correction. These are bounded operations rather than complete Blender topology-tool parity.

- Plane cuts and surface clean-up are implemented: `geometry.bisect` cuts a mesh (or chosen faces) with a plane given by axis and offset or by point and normal, in local or world space, optionally keeping one side and capping the opening; `geometry.delete_components` removes faces, or the faces around edges and vertices; `geometry.flip_normals` reverses whole surfaces; `geometry.triangulate_faces` splits polygons into triangles. They use inspected base IDs, strict revisions, single-command proposals where IDs change, automatic application and saved history. Knife paths are now checked once at the end rather than after every cut, and the shared validation caches what it has already proven, so cuts stay fast on meshes of the editor's full size.

- Material appearance controls are implemented: paged material inspection, Standard/Physical property edits that preserve imported maps, creation/replacement of material slots, and base-face or whole-mesh assignment. Colors, roughness, metalness, opacity, emissive, side and depthWrite are supported. Edits use strict revisions, isolated candidates, automatic application and saved undo/redo. The remaining material scope is below.

- Hierarchy duplication and linear object arrays now use fresh mapped IDs and independent resources, preserve parents/collections, and remap copied Boolean operands. Live mesh array and mirror modifiers support editable repetition/symmetry, source-face mappings, reversed reflected winding, seam welding, base-edit regeneration and saved undo/redo. Mirror uses a local-axis half-plane bisect with convex intersected faces; skin/morph modifier evaluation and interactive movement clipping remain outside this implementation. The Modifiers panel exposes the new controls.

## Remaining sequence

1. Remaining materials: texture import/creation and UV authoring; shared material library, slot removal/reordering, and broader shader controls. Keep managed asset persistence, replay and imported material handling explicit.
2. Measurement authoring: create/rename/remove annotations and set calibrated units through assistant proposals, with optimistic concurrency. Extend annotations with geometry anchors that survive supported edits and explicitly become unavailable when their geometry is deleted.
3. Selection/targeting: set object/component selections through structured editor commands, followed by semantic region and connected-loop queries. Keep source/evaluated mappings and revision checks explicit.
4. Presentation/assets: user-visible framing/camera controls, scene cameras/lights, render settings, and asset import/export. Use managed assets and structured operations, with saved history where appropriate.

For every stage: update the shared protocol where needed, desktop handlers, tool registration, model instructions, skills, tool inventory, tests and history replay checks. Do not describe the remaining stages as implemented until their editor and persistence paths are complete.
