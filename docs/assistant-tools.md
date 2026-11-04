# Assistant tools

This file lists every tool the modeling assistant can call, the editor commands those tools accept, and the rules that decide when a person must approve a change.

It is the reference for the assistant's capabilities. Keep it in step with the code: [AGENTS.md](../AGENTS.md) ("Assistant tools") says when to update it.

## Tool inventory

The modeling coordinator agent (`apps/backend/src/modules/agents/definitions/modeling-coordinator.agent.ts`) receives every tool in the registry, so each tool below is available to it on every run. Model-facing names replace the dot with two underscores (`editor.get_context` is sent as `editor__get_context`).

| Tool | Provider name | Permission | Approval | What it does | Defined in |
| --- | --- | --- | --- | --- | --- |
| `editor.get_context` | `editor__get_context` | `read` | Never | Returns objects, parents, local transforms, visibility, world-space geometry bounds when supported, selection, revision, and `designFocus`: the design mode and, in Edit mode, the components the user has picked. `componentSelection.modifiersEnabled` says whether its ids name the base cage or the display mesh. For mapped face picks, baseFaceIds names the whole source faces. | `modules/tools/editor/editor.tools.ts` |
| `editor.get_scene_summary` | `editor__get_scene_summary` | `read` | Never | Returns object counts by type, selection and revision. | `modules/tools/editor/editor.tools.ts` |
| `editor.inspect_mesh` | `editor__inspect_mesh` | `read` | Never | Returns bounded local-space vertex/edge/face samples, topology counts, material slot count, attributes, bounds, world matrix and mesh paths inside imported objects. Parameters include `objectId`, optional `meshPath`, `view`, sample `offset` and `limit`. Optional `faceQuery` filters faces by local-space `normal`, `minDot` (default 0.9), `centerMin`, and `centerMax`. Its independent `offset` and `limit` (1–1000, default 100) page `faceMatches.ids`, `total` and `hasMore`. Set `includeSamples: false` to omit the three geometry sample pages. The response identifies the view and revision. Evaluated faces include baseFaceIndex when a source is known. | `modules/tools/editor/editor.tools.ts` |
| `viewport.capture` | `viewport__capture` | `read` | Never | Draws the live scene or an isolated pending proposal from 1–6 points of view, with object bounds and projected positions. Use `proposalId` to preview a proposal from the same run and editor before applying it. See [Visual review](#visual-review). | `modules/tools/viewport/viewport.tools.ts` |
| `editor.propose_commands` | `editor__propose_commands` | `propose` | Decided per proposal (see below) | Stores a batch of commands for preview and returns the next action. Nothing changes in the scene yet, and this call does not display an approval card. Call `editor.apply_proposal` with the returned ID, including when approval is required. Can replace a waiting proposal (`supersedes`) and name the plan step it carries out (`stepId`). | `modules/tools/editor/editor.tools.ts` |
| `editor.apply_proposal` | `editor__apply_proposal` | `apply` | Decided per proposal; an unknown proposal always needs approval | Applies a stored proposal to the editor. Each entry of `results` can carry `name`, the name an object received from a command that created, renamed or re-parented it (see [Names and parents](#names-and-parents)). | `modules/tools/editor/editor.tools.ts` |
| `validation.check_scene` | `validation__check_scene` | `read` | Never | Checks duplicate ids, missing parents, parent cycles, non-positive scale, an object in a collection that does not exist, and collections that sit in a missing collection or inside themselves (errors); names shared by objects under one parent or by collections in one place, and groups with children scaled unevenly (warnings); and groups and collections with nothing in them (information). Only errors make `ok` false. | `modules/tools/validation/validation.tools.ts` |
| `skills.load_skill` | `skills__load_skill` | `skill` | Never | Loads the full workflow of a skill selected for this request. | `modules/tools/skills/skills.tools.ts` |
| `modeling.generate_model_plan` | `modeling__generate_model_plan` | `plan` | Never | Records a structured plan. It does not change the scene. Each step's `toolName` must be a known tool. A newer plan replaces the current one. | `modules/tools/modeling/modeling.tools.ts` |
| `modeling.generate_commands` | `modeling__generate_commands` | `read` | Never | Runs synchronous JavaScript against an isolated `scene` snapshot. Optional `inspection` exposes the inspected mesh as `mesh`. Programs can generate bounded `geometry.create_mesh` commands. Returns validated commands and `sourceRevision`, or rejection details. Nothing is proposed or applied. | `modules/tools/procedural/procedural.tools.ts` |
| `modeling.propose_generated` | `modeling__propose_generated` | `propose` | Decided when applied | Runs the same isolated generator and validates and stores a proposal at its source revision without echoing the command arrays. Accepts `summary`, `source`, and optional `inspection`. Inspect a geometry candidate with `viewport.capture` and call `editor.apply_proposal` to apply it or request approval. | `modules/tools/procedural/procedural.tools.ts` |

### Permissions

Each tool declares one permission (`TOOL_PERMISSIONS` in `modules/tools/tool.types.ts`):

- `read`: looks at the scene, checks it, or calculates commands without applying changes.
- `plan`: records intent without changing anything.
- `propose`: stores a batch of commands for review.
- `apply`: changes the scene.
- `skill`: loads instructions for a selected skill.

## Visual review

`viewport.capture` lets the assistant look at the scene instead of reading only numbers. The backend asks the connected editor to draw it offscreen. The desktop renders each view in `apps/desktop/src/features/viewCapture/` and sends back JPEG images with measurements. The visible viewport is not changed: the background, helper objects, materials and lights are altered only while drawing, and put back before the editor answers, even if drawing fails.

### Request

The schema is `viewCaptureRequestSchema` in `packages/editor-protocol/src/view-capture.schema.ts`.

| Field | Meaning |
| --- | --- |
| `proposalId` | Optional pending proposal from the current run. The editor evaluates it on an isolated copy at its stored revision, then discards the copy after capture. An outdated proposal is rejected. Omit the ID for the live scene. |
| `views` | 1–6 points of view. Each has an optional `label`, `projection` (`perspective` or `orthographic`) and `zoom` (0.25–20, applies to presets and orbits), and one of the three ways to place the camera below. |
| `focus` | Object ids to frame and to report exact world bounds for. Without it, views frame the whole scene. Objects the user hid are shown while drawing. |
| `highlight` | Object ids to box in orange in the image. |
| `isolate` | `true` draws only the focused objects (and the objects above them in the hierarchy, whose own shape still draws). |
| `mode` | `solid` (default), `wireframe` for mesh structure, or `normals` for surface direction, which shows flipped or faceted faces. |
| `labels` | Default `true`. Writes object ids on the image, largest objects first, at most 40. |
| `guides` | Default `true`. Draws a floor grid and axes (X red, Y green, Z blue) for scale. |
| `width`, `height` | Pixels, 128–1024. Default 768 by 576. |

Ways to place the camera, in the order they win:

1. `camera`: exact `position`, `target` and optional `fov` (10–120, default 40), in world space. `zoom` does not apply.
2. `orbit`: `azimuthDegrees` and `elevationDegrees` around the framed subject. Azimuth 0 looks at the front from +Z, 90 from +X, 180 from behind. Elevation 0 is level, 90 is straight down.
3. `preset`: `front`, `back`, `left`, `right`, `top`, `bottom`, `isometric` (default), or `current` for the camera the user is looking through now.

Y is up. A front view stands on +Z and looks along -Z, a right view stands on +X, and a top view puts the front of the scene at the bottom of the image. The six axis presets are orthographic unless `projection` says otherwise, so proportions can be judged from them. Presets and orbits stand back far enough to show the focused objects whole, with a margin.

### Result

The model receives a text part first, then one image per view in order. The text is JSON with:

- `coordinates`: a reminder of the axis conventions above.
- `scene`: object count and world bounds of everything.
- `focus`: for each focused object, its world `bounds`, `size` and `center`.
- `missingIds`: ids in `focus` or `highlight` that are not in the scene.
- `views`: for each view, its `label`, size, the camera that was used (projection, position, target, field of view or orthographic height), and each listed object's `screenBounds` (its projected bounding box in pixels, from the top-left) and `inFrame`.

`screenBounds` is the object's bounding box projected into the image. It says where the object is, not whether it is visible or hidden behind something. It is approximate when the camera is inside or behind the box. Objects listed are the focused ones, or the first 60 of the scene.

### Limits and behaviour

- One call draws up to 6 images. Each image must stay under about 1.5 MB as JPEG; the editor lowers the quality, then refuses and asks for a smaller size. The bridge timeout applies (`EDITOR_REQUEST_TIMEOUT_MS`, 15 s by default). Six images of 1024 by 1024 take about half a second.
- The assistant can call the tool as often as it likes, so a deep review is a series of calls: overview views first, then focus and zoom into anything suspicious.
- Images go to the model provider like any other tool result. Normals mode draws both sides of surfaces, including planes.
- Models connected through an OpenAI-compatible endpoint (Chat Completions) cannot take images inside a tool result. For them the run context has `supportsToolImages: false`, the editor skips drawing, and the tool returns the measurements only, with a note saying so. Every other provider receives the images.
- Images are not kept in the stored conversation history. `withoutImages` in `apps/backend/src/modules/sessions/sqlite-session.ts` replaces them with a short placeholder when items are saved, so the history does not grow by hundreds of kilobytes per picture. The text next to them is kept. The assistant is told to state what it concluded in its reply.
- The editor connection answers `view.request` with `view.response`, or `view.error` with a reason when it cannot draw (for example, no viewport is showing).

### What the user sees

The chat shows what the assistant sees. Under the "Looking at the scene" step of a reply, the pictures appear as small labelled thumbnails. Clicking one opens it large, with the camera used, and the arrow keys or buttons move between the views of that capture.

- The tool creates a `captureId` for each call and sends it to the editor in `view.request`. The editor keeps the pictures it draws in memory under that id (`apps/desktop/src/features/viewCapture/capturedPictures.ts`), the last 12 captures only.
- The tool then emits a `viewport.captured` run event with the `captureId`, the label and size of each view, and `imagesSent`. The event carries no pixels, because run events are stored and replayed. The chat attaches the id to the running "Looking at the scene" step (`runEvents.ts`) and `CaptureGallery` finds the pictures by it.
- The pictures live only in the editor window that drew them. After a reload, or for a capture older than the last 12, the step shows no thumbnails.
- When `imagesSent` is false (an OpenAI-compatible model), the step says the scene was measured, not drawn.

## Proposals

Edit mode supports vertex, edge and polygon-face selection on the active mesh. Clicking another visible object switches the active edit target. Click the active object to select components and Shift-click to toggle them. Press B and drag to box-select component centers on the active mesh part, with Shift to add. Switching component types converts the selection through shared vertices. The last component selection is stored locally per project and restored only if the mesh cage still matches. On selected faces, G or the Move button moves the shared cage vertices, S scales and R rotates. X, Y or Z constrains the transform. E extrudes a region, starting on the average face normal when defined. During a face extrusion, G moves the cap, S scales it, and R twists it. After R, X, Y or Z tilts around the corresponding mesh-local axis. The Extrusion menu also offers connected extrusion along vertex normals, individual faces, and closing an entire planar sheet as a solid. Enter or left click confirms, and Escape or right click cancels. The new cap stays selected for another edit. An assistant mesh inspection ends an open preview so it reads committed geometry.

Manual edits save through `POST /projects/:id/scene/edits` and participate in saved undo and redo. The Modifiers panel updates `geometry.set_modifiers`. Edit-mode face transforms save `geometry.transform_faces`, and extrusion saves `geometry.extrude`. The Add menu creates and positions new primitives through the same route. The Scene list saves renaming (double click or F2), re-parenting (dragging onto an object, or onto the top-level strip), collections (making, renaming, hiding, deleting, and dragging objects and collections into them) and showing or hiding through it too. The route accepts only commands a person makes by hand (transforms, visibility, renaming, re-parenting, collections, deletion, new primitives, modifier stacks and component edits). It checks that every object a command names, the parent a `scene.set_parent` or a new primitive names, and every collection a command names is in the project, that a new collection id is unused, and refuses assistant-only commands such as `scene.move_object`. It does not read the history to look for parent loops: the editor prepares each edit against the live scene, where the loop check runs, before it is saved. Manual re-parenting keeps the baking described under [Re-parenting and shear](#re-parenting-and-shear). Preparation validates the candidate before save. The assistant uses proposals and approval for geometry edits.

A proposal is a stored batch of scene commands. The assistant writes it, the backend checks it against the scene, and it waits there until it is applied, rejected or replaced. The assistant can never change the scene without a proposal.

### Lifecycle

| Status | Meaning |
| --- | --- |
| `proposed` | Stored and checked. Waiting to be applied, rejected or superseded. |
| `applying` | Being sent to the editor. |
| `applied` | The editor ran the batch. The commands are saved in the project history. |
| `failed` | The editor refused the batch, or it no longer fits the scene. Nothing changed. |
| `rejected` | The user refused it while it was still `proposed`. |
| `superseded` | Replaced by a newer proposal while it was still `proposed`. It can no longer be applied. |

### Rebasing

Current editors advertise `supportsPreparedCommands`. The backend sends a `prepare` execution to build an isolated candidate without changing the displayed scene, commits the proposal result and project history in one transaction, then sends `commit` to display it. Storage failure sends `discard`. Closing the connection discards uncommitted candidates. Prepared scene geometry has a conservative 128 MiB buffer budget. The same proposal id makes repeated commits idempotent. A persisted `delivery_pending` flag survives backend restart; authenticated reconnect restores the saved project before another run starts, and run completion checks for undelivered saved edits. Run inference itself is not resumed after restart. Older editors without this capability use the legacy execution path and do not gain the full prepare/save/display guarantee.

Saved project undo/redo uses `POST /projects/:id/scene/history/preview` with `{ direction: "undo" | "redo" }`, then `POST /projects/:id/scene/history/commit` with direction, preview version and unique operationId. Ownership and active-run checks apply. The desktop fully replays the preview and loads its assets before commit; stale previews are rejected. Retrying the same operationId does not undo twice. The live scene is replaced after commit. Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z (or Ctrl+Y) cover saved imports, deletes, geometry and assistant changes, including history reopened from disk. Adjacent assistant batches from one run form one action; manual multi-batch gestures use `actionId` on scene edits. A new edit abandons redo. This user-driven history API is not an assistant tool and cannot bypass approval for new model-generated commands.

`editor.propose_commands` accepts optional `expectedRevision` (nonnegative integer). For calculated commands pass the generator's `sourceRevision`. A mismatch rejects the proposal before it is stored or supersedes anything. This persists a strict revision flag: if the scene changes before application, the proposal fails without rebasing. Regenerate and propose again. Proposals without `expectedRevision` keep the behavior below.

The batch is written against the scene revision it was checked on. If the scene changes before the batch is applied, the editor reports a revision conflict. The backend then re-checks the batch against the current scene:

- If every command still fits, the batch runs again on the current scene and the result has `rebased: true`.
- If a command no longer fits (for example its object was deleted), the proposal fails with a message that says the scene changed, and the assistant must propose again.

Rebasing keeps the batch's absolute values. A transform sets the object's position, so it overwrites a manual move made in between. Rebasing does not check which objects the user changed.

### Superseding

`editor.propose_commands` accepts `supersedes`, the id of a waiting proposal from the same run. The new proposal is checked first. If it passes, the old proposal becomes `superseded`. A proposal that was already applied or rejected cannot be superseded.

### Plan steps

`editor.propose_commands` accepts `stepId`, a step id of the latest recorded plan. If it matches, the result echoes the step. If it doesn't match, the result is `rejected` with the ids that are available, and no proposal is stored. The step link is shown in the proposal event but is not saved with the proposal.

### Approval

Approval is decided by `ApprovalPolicy` (`modules/approvals/approval.policy.ts`).

- A proposal needs the user's approval when it has more than **100** commands (`LARGE_BATCH_THRESHOLD`), or when it contains a destructive command.
- Destructive commands are `scene.delete_object`, and `geometry.create_primitive` with `replaceExisting: true`.
- `geometry.bevel`, `geometry.boolean`, `geometry.subdivide`, `geometry.set_modifiers`, `geometry.extrude`, `geometry.transform_faces`, `geometry.fill_hole`, and `geometry.subdivide_faces` require approval and strict revisions. A scene change requires a fresh proposal.
- Renaming, hiding and re-parenting are not classified as destructive; batches over 100 commands still require approval.
- `editor.apply_proposal` asks for approval when its proposal does. If the proposal cannot be found, approval is asked for anyway, so a person still sees the request.

## Editor commands

`editor.propose_commands` accepts a list of commands, at most **200** (`MAX_COMMANDS_PER_PROPOSAL`). Commands run in order, and a later command may use an object created or moved earlier in the same batch. The schema lives in `packages/editor-protocol/src/editor-command.schema.ts`, and the backend re-exports it from `apps/backend/src/shared/schemas/editor-command.schema.ts`.

| Command `type` | Purpose | Destructive |
| --- | --- | --- |
| `scene.create_object` | Adds an empty group or parent, optionally under `parentId` and in `collectionId`. Its `name` is made unique among its siblings. | No |
| `scene.transform_object` | Sets an existing object's position, rotation or scale to the values given. Parts left out are unchanged. | No |
| `scene.move_object` | Adds `delta` `[x, y, z]` to an existing object's position, along its parent's axes, as the object is when the command runs. Unlike `scene.transform_object` it keeps a move made after the batch was written, so it is the command for "move it up by 2" and it rebases correctly. `delta` must move the object and stay within ±100000 per axis. Editors without `supportsSceneGraph` refuse it. | No |
| `scene.rename_object` | Changes the name of an existing object. A name that a sibling already has gets a number (`Arm`, `Arm.001`). | No |
| `scene.set_visibility` | Shows or hides an existing object. | No |
| `scene.set_parent` | Moves an existing object under another object, or to the top level (`parentId: null`). The object keeps its place in the world. When the parent's scale and the object's rotation cannot be stored as position, rotation and scale, the leftover is baked into the mesh (and into children) so the world shape stays. Replaying the command bakes it the same way. It cannot go under itself or under anything below it. If a child of the new parent already has its name, the moved object is renamed with a number. A proposal from the assistant is refused when the move cannot be exact (see [Re-parenting and shear](#re-parenting-and-shear)). | No |
| `scene.delete_object` | Removes an existing object. Its children must be removed first. | Yes |
| `scene.create_collection` | Makes a collection: `collectionId`, `name`, and optional `parentCollectionId` to nest it. A name that a collection in the same place already has gets a number. Needs `supportsCollections`. | No |
| `scene.rename_collection` | Renames a collection, with the same numbering. | No |
| `scene.set_collection_visibility` | Shows or hides a collection, and with it what is in it and in the collections inside it. An object's own flag is not touched. | No |
| `scene.move_collection` | Puts a collection inside another (`parentCollectionId`), or at the top (`null`). Refused inside itself or inside what it holds. | No |
| `scene.delete_collection` | Removes a collection. Refused unless nothing is in it, neither objects nor collections, so nothing is deleted by it. | No |
| `scene.move_to_collection` | Puts an object in a collection (`collectionId`), or in the scene itself (`null`), together with everything that hangs below it unless `includeChildren` is `false` (default `true`). Nothing moves in space and the parent is unchanged. | No |
| `geometry.create_primitive` | Creates a box, sphere, cylinder, cone, torus, plane, tetrahedron, octahedron or icosahedron. Required `size` supplies defaults. Optional `name` (the kind of shape when left out), `parentId` (an existing object, or one created earlier in the batch) and `transform` (position, rotation and scale local to the parent) create, name, parent and place the shape in one command; they cannot be combined with `replaceExisting`. Optional `collectionId` puts it in a collection (see [Collections](#collections)). Editors that do not advertise `supportsSceneGraph` refuse them. Optional `options` set box width/height/depth, plane width/height, sphere radius/widthSegments/heightSegments, cylinder radiusTop/radiusBottom/height/radialSegments/heightSegments, cone radius/height/radialSegments/heightSegments, torus radius/tube/radialSegments/tubularSegments, and polyhedra radius/detail. Dimensions are mesh-local, positive and at most 100, except one cylinder radius may be zero. Segments are bounded and the generated mesh must fit the 20,000-triangle editable input limit. Detail is 0–4. With `replaceExisting: true` it replaces an existing object's shape. | Only with `replaceExisting: true` |
| `geometry.create_mesh` | Creates a new polygon mesh. Supply a fresh `objectId`, optional `name`, optional `parentId` and `transform` (local to the parent; refused by editors without `supportsSceneGraph`), `shading` (`flat`, default, or `smooth`), 3–4096 mesh-local `vertices`, and 1–4096 `faces` containing 3–64 distinct zero-based vertex indices each. Coordinates are finite and within ±10,000, every vertex must be referenced, and the output must fit 20,000 triangles. Vertex positions must remain distinct at Float32 precision. The editor rejects zero-area faces, inconsistent winding and non-manifold topology. Open boundaries are allowed. Self-intersection and UV authoring are outside these checks. | No |
| `geometry.bevel` | Appends a live bevel with mesh-local `width` (greater than 0, at most 100), `segments` (1–8, default 1), `profile` (`chamfer`, `round` or `circular`, default `round`), and minimum crease `angle` (0–180 degrees). Coplanar edges are skipped. | Yes |
| `geometry.boolean` | Appends a live `difference` (default), `union` or `intersect`. Supply `objectId`, optional `meshPath`, `operandObjectId`, optional `operandMeshPath`, and optional `cutMaterialIndex` for an existing target material slot. The cutter must already exist. Can share a modifier batch with bevel. | Yes |
| `geometry.subdivide` | Appends a live subdivision modifier. Parameters: `objectId`, optional `meshPath` (default `[]`), `levels` (integer 1–3), optional `method` (`catmull-clark`, `linear` or `loop`, default `catmull-clark`). | Yes |
| `geometry.set_modifiers` | Sets the full ordered live stack. Parameters: `objectId`, optional `meshPath` (default `[]`), `modifiers` (0–8 entries). Entries have unique `id`, `kind` (`bevel`, `subdivision`, `extrusion`, or `boolean`), `enabled` (default true), and that kind's parameters. Edit parameters, reorder, disable, remove, or clear to restore base geometry. A `boolean` entry names an existing `operandObjectId` and optional `operandMeshPath` (default `[]`). `operation` is `difference` (default; the operand cuts this mesh), `union`, or `intersect`. | Yes |
| `geometry.extrude` | Extrudes 1–4096 base component IDs using exactly one of mesh-local `offset` or signed face `normalDistance`. Face `normalMode` is `region` (default), `vertex` or `individual`. Caps accept `capScale` or `capScaleXY`, mesh-local `capRotationDegrees` and `twistDegrees`. Use `steps` (1–16) to repeat a face extrusion, or `closeOpenSurface` to close a complete planar sheet with a single normal extrusion. | Yes |
| `geometry.transform_faces` | Transforms 1–4096 selected base faces by moving their shared vertices. Supply `transform.position` as a delta, `transform.rotation` in XYZ radians, or `transform.scale` with factors 0.001–100. Rotation and scale use the selected vertices' centroid. `space` is `local` (default) or `world`. `componentView: base` requires verified base IDs and `expectedRevision`. | Yes |
| `geometry.subdivide_faces` | Subdivides only the listed faces of the base cage. Parameters: `objectId`, optional `meshPath` (default `[]`), `ids` (1–4096 face indices from `editor.inspect_mesh`). Each selected face gets a centre point and one quad per corner, and each edge it shares with an unselected face gets a midpoint there too, so the mesh stays closed and the unselected faces keep their shape. Concave selected faces are triangulated first, so only the selection changes. The result's selection is the new quads. Disable enabled modifiers first. | Yes |
| `geometry.fill_hole` | Fills one simple boundary loop. Nonplanar loops require a simple projection and are triangulated. Pass `objectId`, optional `meshPath`, and `ids` of 3–256 canonical boundary edges. To retain enabled modifiers, inspect the base cage, set `componentView: base`, and propose at the inspection revision. | Yes |

The desktop applies these commands in `apps/desktop/src/features/assistant/EditorScene.ts`. Any command added to the protocol must also be handled there.


### Mesh inspection and surface operations

Call `editor.inspect_mesh` before modifying geometry. `meshPath` is a path to one mesh inside the scene object; `[]` targets the object itself. Each step goes from a part to one of its children and is written one of two ways: by name (`"Arm"` for the child with that name, `"Arm#1"` for the second child with that name, counting from 0) or by child index (`2`). A name keeps meaning the same part when other parts are added, removed or reordered; an index means whatever is at that position now, which is the form paths had before names and still means exactly what it did. `editor.inspect_mesh` returns each part's path by name, with `#n` for a repeat of a name and an index for a part with no name, and `editor.get_context` reports the user's picked part the same way. Use paths as returned. Names are matched exactly; a name that ends in `#` and a number is returned with an explicit count (`"Arm#1#0"`) so that it is not read as one. A path that leads to no part fails the command and says to inspect again. Imported groups return up to 100 mesh parts and their paths, with `partsTruncated` when there are more or a path exceeds 32 levels. Select a part and inspect again. Path validity is checked in the editor; revision checks prevent using a path after the hierarchy changes.

Inspection additionally returns `modifiers`, `baseTriangles`, `skinned` and `morphTargets`. Successful inspection returns `status: ok`, statistics for render vertices, welded vertices, polygon faces, edges, source triangles, boundary edges, non-manifold edges, inconsistent edge winding, attribute names, material group count and material slot count. `vertices`, `edges` and `faces` are paged independently using the same `offset` and `limit`. References use the full welded vertex/face index spaces, so samples may reference vertices or faces on another page. `localBounds` and column-major `matrixWorld` relate these local-space positions to the scene. These are geometric diagnostics, not a visual-quality or self-intersection check. Non-manifold vertex fans are additionally rejected when applying modifiers. An absent object returns `not_found`; a group target or unsupported source returns `unsupported` with a message and any discovered parts. Older editors may return no inspection support.

The editor welds position seams at relative tolerance 1e-7 (minimum 1e-10 local units), drops collapsed triangles and dissolves connected coplanar triangles into polygon control faces where the boundary is one loop with at most 256 corners. More complex regions retain triangles. Original authored quad topology cannot be recovered exactly from a triangulated import. Generated control polygons are retained for subsequent operations and reconstructed deterministically when command history is replayed.

Subdivision offers Catmull–Clark, Linear and Loop. Linear adds density without smoothing the form. Bevel offsets the adjacent faces, connects them with edge strips and fills the corner junctions. Profile `circular` follows a circular arc in the edge cross-section, `round` uses the existing quadratic profile, and `chamfer` produces a flat strip. One segment produces a flat strip for any profile. The angle threshold applies only to non-coplanar shared edges. Boundary edges on open meshes remain open. An overlapping bevel width can be rejected.

Live stacks retain an independent base geometry. Bevel, Boolean and subdivision commands append entries (the command id becomes the modifier id, with a suffix if needed); `geometry.set_modifiers` replaces the full list. Enabled entries evaluate in order from the base. Clearing all entries restores the base; disabling an entry leaves it listed without evaluating it. Inspection exposes the ids and parameters. Stacks are copied into prepared candidates and rebuilt through saved history and undo/redo. The Modifiers panel edits the same stack: bevel profile and angle, named Catmull–Clark, Linear and Loop subdivision, and Boolean operation, operand mesh and cutter surface material.

**A Boolean that uses a part of an imported model** keeps working through every kind of batch. The editor checks a batch that creates, re-parents or replaces objects on copies of the objects, and the model's inner parts are not part of a copy, so for the time the cuts are worked out the parts are lent to the copy and handed back exactly as they were if the batch fails. The cuts are then worked out from where everything is after the batch, including when the cutter or the model is moved in the same batch, and also when it is a part of the model that is being cut by a scene object.

An operand path written with child indexes is stored by part name wherever the part has one, at the moment the modifier is set (`geometry.set_modifiers` or `geometry.boolean`, by the interface or the assistant). An index points at whatever is at that position now, and putting an object in front of a model's parts, or deleting one that was there, moves every position; a Boolean stored by index would then cut with another part and say nothing. Stored by name it does not. A part with no name keeps its index, which is all there is to go by; a path that leads nowhere is left as written and reported when the cut is worked out. Replaying a project does the same at the same point, so it comes out the same.

Boolean uses the operand's evaluated geometry and relative transform. The inputs must be closed manifold solids. Cycles, self operands, open surfaces, skinned meshes, morph targets and empty results are rejected. The operand remains in the scene and is required until the modifier is removed. The Manifold solver supplies seam connectivity and material provenance. The editor dissolves compatible coplanar triangles into polygons when they have a single simple boundary. UVs and vertex colors are interpolated. Surfaces keep valid material indices or fall back to slot 0, and `cutMaterialIndex` overrides the cutter surfaces. Later modifiers evaluate on the cut result.

Operations preserve face-varying UV seams and material assignments. Generated face points and vertices carry interpolation stencils for attributes and deformation. Skin joints retain the four strongest interpolated influences by magnitude, including negative corrective weights, normalized by their signed sum; influences beyond four are dropped. Relative and absolute morph positions are interpolated, morph normals are regenerated, and mesh skeleton bindings, target names and active influences remain intact. New bevel strips inherit an adjacent face's material; corner patches use a neighboring material and interpolated source values. This preserves usable texture coordinates but does not author an artist-controlled unwrap for new surfaces. Tangents are rebuilt when supplied with UVs. Custom numeric vertex attributes use linear interpolation; categorical or shader-specific attribute semantics are not inferred.

Geometry modifier commands share batches of at most 20. Extrusion, face transforms, hole fill and selected-face subdivision share their own component batches of at most 20. Place cutters in a separate scene command batch first. A failed operation leaves the scene and modifier stack intact. With enabled modifiers, component commands that support `componentView: base` require base IDs and the inspection revision.

For face extrusion, `normalMode: individual` uses one normal per face. Adjacent coplanar faces require region mode. `capScaleXY` replaces uniform `capScale` with two scales perpendicular to the displacement. Its X axis is mesh-local X projected perpendicular to displacement, falling back to mesh-local Y near parallel. `capRotationDegrees` applies mesh-local XYZ rotation before twist.

A live `extrusion` entry goes first, with `ids` and `baseKey` from a base inspection. Face entries accept a signed `normalDistance` from -100 to 100 or an explicit `offset`, and the same shaping options as direct extrusion. Edge and paired-vertex entries use `componentKind` and an `offset`. Propose the stack at the inspection revision. The editor checks the base key before evaluating, and the modifier is retained when a hole fill appends a face, or a base extrusion or face transform preserves all anchored faces and their vertex positions. Other base edits require removing the live extrusion first. The Modifiers panel exposes the applicable distance, offset, scale, rotation, and twist settings.

Limits: 20,000 raw input triangles, 100,000 output triangles per mesh, 200,000 staged triangles per batch, eight stack entries, 1–3 levels per subdivision entry, 1–8 bevel segments, bevel angle 0–180 degrees, subdivision vertex valence at most 64, and a conservative 128 MiB output attribute budget. Generated cages retain polygon metadata for further evaluation within the output limit. Large or invalid inputs fail before committing scene changes. Inspection caching misses when position, index, skin, morph or any other vertex attribute changes.

## Scene objects

The editor snapshot lists objects with a `type`. The protocol allows `mesh`, `empty`, `collection`, `camera` and `light`. The desktop currently creates only `mesh` (primitives) and `empty` (groups). `visible` is included when the desktop reports it.

### Names and parents

An object has an `id`, a `name` and at most one parent. The `id` is what commands refer to. The `name` is a label for people and for matching what the user says ("the left arm") to an object. Neither the assistant nor the editor treats a name as a reference.

- **Names are unique among siblings**, the objects with the same parent (the top level is one set of siblings). The same name may be used under different parents. When a name is already taken among the siblings, the lowest free number is added: `Arm`, `Arm.001`, `Arm.002`. A name that already ends in a number counts up from its stem. The result depends only on the set of sibling names, not on the order they were created in. A name that would pass 80 characters once numbered fails the command instead of being cut.
- **The rule applies everywhere an object gets a name**: `scene.create_object`, `geometry.create_primitive`, `geometry.create_mesh`, `scene.rename_object`, `scene.set_parent` (the new siblings) and an imported model. Creating a shape without a name names it after its kind, as before.
- **Applying a batch reports the names.** Each entry of an applied result can carry `name`. Read it instead of assuming the name that was asked for.
- **A shape can be created under a parent.** `parentId` on `geometry.create_primitive` and `geometry.create_mesh` puts it under an existing object or one created earlier in the batch, and `transform` is local to that parent. Moving, turning or scaling the parent then moves all its children, so a figure built under one group moves with one `scene.transform_object`.
- **Capability.** The editor sets `supportsSceneGraph` in its context. The backend refuses `name`, `parentId` and `transform` on shapes and meshes, and `scene.move_object`, for an editor that does not set it, and says how to get the same result with `scene.rename_object`, `scene.set_parent` and `scene.transform_object`.
- **Saved projects.** A project is rebuilt by replaying its commands, so the rule also runs on batches saved before it existed. Objects that shared a name under the same parent then get numbered names the next time the project is opened. Only labels change; ids, parents and transforms do not.

### Collections

A collection is a named, nestable group of objects that can be hidden together. It organizes the scene and changes no place: an object's parent says where it is, its collection says which group it is listed in.

- **One collection per object.** An object is in exactly one collection; an object in none is in the scene itself. Collections nest. Collection ids are separate from object ids, so an object and a collection may share an id.
- **Moving objects in.** `scene.move_to_collection` takes the object and everything that hangs below it, through any number of parents, unless `includeChildren` is `false`. A new object joins the `collectionId` it is given, else its parent's collection, else the scene itself. Replacing a shape keeps its collection; deleting an object removes it from its collection.
- **Names.** A collection's name is unique among the collections in the same place, with the same numbering as object names (`Props`, `Props.001`). The apply result reports the name.
- **Hiding.** A collection that is hidden hides what is in it and in the collections inside it. The editor keeps each object's own flag apart from that: showing the collection again shows only what was not hidden on its own, and an object cannot be shown by hand while its collection is hidden. `editor.get_context` reports each object's own flag as `visible`, its `collectionId`, and every collection with its own `visible`; an object's drawn state is its own flag together with those of its collections. Everything that reads whether an object is drawn (picking, box select, view capture) sees the combined result.
- **Deleting.** `scene.delete_collection` is refused while anything is in it and names what is. It is not destructive, so it needs no approval.
- **Capability.** The editor sets `supportsCollections` in its context. The backend refuses every collection command, and `collectionId` on a creation command, for an editor that does not set it.
- **One implementation.** The rules are in `packages/editor-protocol/src/collection-graph.ts` (`CollectionModel`), used by the editor on the live scene and by the validator on a snapshot. The validator itself (`validateAgainstContext`) is in `packages/editor-protocol/src/validate-commands.ts`, and a desktop test puts thousands of random batches to it and to the editor and requires them to agree.
- **Saving.** Collections are part of the command history, so they replay, undo and redo with the rest. The project's object index holds collection ids under the key `collection:<id>`, which no object id can have, so the existing index logic (history, duplication, rebuilding) covers them.

### Re-parenting and shear

`scene.set_parent` keeps the object where it is in the world, so its place under the new parent is the inverse of the parent's world matrix times its own. Position, rotation and scale can store that only when the object's axes stay perpendicular. They do not when something above the object, or above the new parent, is scaled by different amounts on different axes and the object is turned relative to it (a turned child under a parent scaled 2:1:1), and they cannot when a scale is 0. The editor then folds the leftover into the mesh and its children, and for a scale of 0 that flattens the mesh for good.

- **Manual edits** (dragging in the Scene list) keep that behavior.
- **The assistant's proposals** are refused instead, with a message that names the object and how to avoid it. The backend judges the move on a snapshot of the scene, following the batch's earlier creations, transforms, moves and re-parenting (`PlacementTracker`, `packages/editor-protocol/src/placement-tracker.ts`), so a batch that scales a group and then moves a turned part under it is caught at proposal time and again when it is applied. The way around it is to give the group the same scale on every axis, or to create the part under the group with `parentId` (its transform is then stored directly and nothing is sheared).
- **`validation.check_scene`** reports a group that has children and an uneven scale as a warning, since a later move under or out of it would be refused.
- The maths is in `packages/editor-protocol/src/transform-math.ts`. The desktop tests compare it with three.js and with the editor's own decision, so the two cannot drift apart unnoticed.

The rules live in `packages/editor-protocol/src/scene-graph.ts` (`resolveSiblingName`, `SiblingNames`, `isWithinBranch`) so the backend's proposal check and the desktop's editor use one implementation. `SiblingNames` is the same rule for a run of creations in one batch: it keeps the names under each parent and resumes the search for a free number, so a batch of hundreds of same-named shapes stays linear (the `editor/execute` benchmark guards this).

`editor.get_context` also returns optional `worldBounds`: `{ min: [x,y,z], max: [x,y,z] }` in world coordinates including descendant geometry, or `null` for objects without geometry. Bounds include hidden geometry and use geometry bounding boxes; they do not evaluate skinning, morph deformation, collisions or visual quality. Transforms remain local to parents. Older editors may omit bounds.

## Procedural programs

`modeling.generate_commands` accepts only `source`: 1–16,000 characters of synchronous JavaScript function body. `scene` is an isolated JSON snapshot; modifying it cannot affect the editor. Return 1–200 commands from the command table above. Loops, arrays, helper functions and `Math` are available. The output is parsed by the strict protocol schema and checked against the snapshot, including command IDs and object references.

Each invocation uses a fresh QuickJS runtime compiled to WebAssembly, with no host functions or module loader. Node APIs, imports, filesystem, credentials, network, timers and live editor access are unavailable. Limits: 250ms interpreter deadline, 16MiB guest heap, 256KiB guest stack, 256,000 output characters. No async jobs are executed. This small synchronous computation occupies the backend event loop until it returns or is interrupted; cancellation delivered during computation can wait until the deadline. This is interpreter isolation, not a separate OS worker. Host capabilities must not be added without revisiting that boundary.

Example function body (positions are local to each object's parent):

```js
return scene.selectedObjectIds.map((objectId, i) => ({
  commandId: `move_${i}`,
  type: "scene.transform_object",
  objectId,
  transform: { position: [i * 2, 0, 0] },
}));
```

Submit the returned `commands` through `editor.propose_commands` with `expectedRevision: sourceRevision`, then `editor.apply_proposal`. Existing approval rules apply to the resulting commands. Programs cannot add unsupported mesh or material operations. Generated source never reaches the editor; accepted commands use the prepared scene protocol and saved project undo/redo. Visual render feedback is provided separately by viewport capture.

## Skills and the tools they name

Skills are in `skills/<id>/SKILL.md`. Their `tools:` list tells the model which tools a workflow uses. The list is informational: the agent still receives every registered tool.

| Skill | Tools named |
| --- | --- |
| `character-modeling` | `editor.get_context`, `modeling.generate_model_plan`, `editor.propose_commands`, `editor.apply_proposal`, `validation.check_scene` |
| `2.5d-character-design` | `editor.get_context`, `modeling.generate_model_plan`, `editor.propose_commands`, `editor.apply_proposal`, `validation.check_scene` |
| `mesh-editing` | `editor.get_context`, `editor.inspect_mesh`, `viewport.capture`, `modeling.generate_commands`, `modeling.propose_generated`, `editor.propose_commands`, `editor.apply_proposal`, `validation.check_scene` |

## Not exposed to the assistant

Every change to the scene that the desktop can make is a command the assistant can propose (every command type in the table above). These are deliberately outside its reach:

- **Undo and redo.** History belongs to the user. The assistant's changes are saved in it, so the user can undo them.
- **Projects, accounts and settings.** Duplicating, renaming, archiving or deleting projects, and provider keys and settings, are not editing actions.
- **Files.** Importing a model needs a file the user chooses. The assistant sees only models the user has imported.
- **Selection and viewport.** Object and component selection, Object/Edit mode and the camera are interface state. The assistant can read them (`selectedObjectIds`, `designFocus`) and capture views, but not change them.
- **Operations the desktop does not have.** Materials and colours, and component scale, rotate or inset, are not implemented in the editor, so no command exists for them.

- **MCP tools.** `McpRegistry` (`modules/mcp/mcp.registry.ts`) is default-deny: a tool is usable only when its server is enabled and the tool is listed in `allowedTools`. No MCP tool is wired into the agent yet, so none appears in the inventory above.

## How a tool is wired

1. **Define.** Write the tool with `defineTool` in `apps/backend/src/modules/tools/<area>/<area>.tools.ts`. The name must match `namespace.snake_case` (`TOOL_NAME_PATTERN`).
2. **Register.** Add the tool to the list returned by the factory in `apps/backend/src/modules/tools/tools.module.ts`. Tools are listed as editor, validation, skills, procedural computation and planning. Plan steps are checked against every registered tool.
3. **Check.** `ToolRegistry` rejects an invalid or duplicate name at startup.
4. **Expose.** `createModelingCoordinatorDefinition` passes every registered tool to the agent and lists the provider names in the instructions (`modeling-coordinator.instructions.ts`).
