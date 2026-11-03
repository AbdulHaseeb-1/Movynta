# Assistant tools

This file lists every tool the modeling assistant can call, the editor commands those tools accept, and the rules that decide when a person must approve a change.

It is the reference for the assistant's capabilities. Keep it in step with the code: [AGENTS.md](../AGENTS.md) ("Assistant tools") says when to update it.

## Tool inventory

The modeling coordinator agent (`apps/backend/src/modules/agents/definitions/modeling-coordinator.agent.ts`) receives every tool in the registry, so each tool below is available to it on every run. Model-facing names replace the dot with two underscores (`editor.get_context` is sent as `editor__get_context`).

| Tool | Provider name | Permission | Approval | What it does | Defined in |
| --- | --- | --- | --- | --- | --- |
| `editor.get_context` | `editor__get_context` | `read` | Never | Returns objects, parents, local transforms, visibility, world-space geometry bounds when supported, selection and revision. | `modules/tools/editor/editor.tools.ts` |
| `editor.get_scene_summary` | `editor__get_scene_summary` | `read` | Never | Returns object counts by type, selection and revision. | `modules/tools/editor/editor.tools.ts` |
| `editor.inspect_mesh` | `editor__inspect_mesh` | `read` | Never | Returns bounded local-space vertex/edge/face samples, topology counts, attributes, bounds, world matrix and mesh paths inside imported objects. Parameters: `objectId`, optional `meshPath` (default `[]`), `offset` (default 0), `limit` (1–100, default 25). | `modules/tools/editor/editor.tools.ts` |
| `viewport.capture` | `viewport__capture` | `read` | Never | Draws the live scene from 1–6 points of view and returns the images with exact object bounds and where each object lands in each image. Nothing changes in the scene. See [Visual review](#visual-review). | `modules/tools/viewport/viewport.tools.ts` |
| `editor.propose_commands` | `editor__propose_commands` | `propose` | Decided per proposal (see below) | Stores a batch of commands for preview and returns the next action. Nothing changes in the scene yet, and this call does not display an approval card. Call `editor.apply_proposal` with the returned ID, including when approval is required. Can replace a waiting proposal (`supersedes`) and name the plan step it carries out (`stepId`). | `modules/tools/editor/editor.tools.ts` |
| `editor.apply_proposal` | `editor__apply_proposal` | `apply` | Decided per proposal; an unknown proposal always needs approval | Applies a stored proposal to the editor. | `modules/tools/editor/editor.tools.ts` |
| `validation.check_scene` | `validation__check_scene` | `read` | Never | Checks duplicate ids, missing parents, parent cycles, and non-positive scale. | `modules/tools/validation/validation.tools.ts` |
| `skills.load_skill` | `skills__load_skill` | `skill` | Never | Loads the full workflow of a skill selected for this request. | `modules/tools/skills/skills.tools.ts` |
| `modeling.generate_model_plan` | `modeling__generate_model_plan` | `plan` | Never | Records a structured plan. It does not change the scene. Each step's `toolName` must be a known tool. A newer plan replaces the current one. | `modules/tools/modeling/modeling.tools.ts` |
| `modeling.generate_commands` | `modeling__generate_commands` | `read` | Never | Runs a synchronous JavaScript function body (`source`) against an isolated scene snapshot. Returns validated commands and `sourceRevision`, or rejection details. Nothing is proposed or applied. | `modules/tools/procedural/procedural.tools.ts` |

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

Edit mode supports vertex, edge and polygon-face selection on the active object. Click selects; Shift-click adds or removes components on the same mesh part. Selection is transient and clears on scene changes or mode changes. Overlays and picking geometry reuse the modifier topology reader and concave polygon triangulation; mesh editing limits apply. This does not add component transforms, extrusion or inset commands.

Manual modifier editing is available in the selected object's Modifiers panel. It targets the active mesh part, prepares a candidate scene, saves `geometry.set_modifiers` through the user-driven `POST /projects/:id/scene/edits` route, then displays the result. The Add menu creates cube, sphere, cylinder, cone, torus and plane primitives through this route. It accepts new primitives with fresh ids (no replacement), followed by transforms in the same batch, plus transforms, deletion and modifier stacks for existing objects; it is not exposed as an assistant tool. Failed preparation leaves the scene and history untouched. Uncertain save delivery requires scene recovery. Manual modifier edits participate in saved undo/redo. The assistant still uses proposals and their existing approval rules.

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
- `geometry.bevel`, `geometry.subdivide` and `geometry.set_modifiers` also require approval because they replace existing geometry. They always use strict revisions, even when `expectedRevision` is omitted; a scene change requires a new proposal instead of automatic rebasing.
- Renaming, hiding and re-parenting are not classified as destructive; batches over 100 commands still require approval.
- `editor.apply_proposal` asks for approval when its proposal does. If the proposal cannot be found, approval is asked for anyway, so a person still sees the request.

## Editor commands

`editor.propose_commands` accepts a list of commands, at most **200** (`MAX_COMMANDS_PER_PROPOSAL`). Commands run in order, and a later command may use an object created or moved earlier in the same batch. The schema lives in `packages/editor-protocol/src/editor-command.schema.ts`, and the backend re-exports it from `apps/backend/src/shared/schemas/editor-command.schema.ts`.

| Command `type` | Purpose | Destructive |
| --- | --- | --- |
| `scene.create_object` | Adds an empty group or parent, optionally under `parentId`. | No |
| `scene.transform_object` | Moves, rotates or scales an existing object. | No |
| `scene.rename_object` | Changes the name of an existing object. | No |
| `scene.set_visibility` | Shows or hides an existing object. | No |
| `scene.set_parent` | Moves an existing object under another object, or to the top level (`parentId: null`). The object keeps its place in the world. When the parent's scale and the object's rotation cannot be stored as position, rotation and scale, the leftover is baked into the mesh (and into children) so the world shape stays. Replaying the command bakes it the same way. It cannot go under itself or under anything below it. | No |
| `scene.delete_object` | Removes an existing object. Its children must be removed first. | Yes |
| `geometry.create_primitive` | Creates a box, sphere, cylinder, cone, torus or plane. With `replaceExisting: true` it replaces an existing object's shape. | Only with `replaceExisting: true` |
| `geometry.bevel` | Appends a live bevel modifier to manifold concave/open geometry. Parameters: `objectId`, optional `meshPath` (default `[]`), `width` (finite, greater than 0, at most 100), optional `segments` (integer 1–8, default 1). Width is a mesh-local face inset distance. | Yes |
| `geometry.subdivide` | Appends a live Catmull–Clark subdivision modifier. Parameters: `objectId`, optional `meshPath` (default `[]`), `levels` (integer 1–3). | Yes |
| `geometry.set_modifiers` | Sets the full ordered live stack. Parameters: `objectId`, optional `meshPath` (default `[]`), `modifiers` (0–8 entries). Entries have unique `id`, `kind` (`bevel` or `subdivision`), `enabled` (default true), and width/segments or levels. Edit parameters, reorder, disable, remove, or clear to restore base geometry. | Yes |

The desktop applies these commands in `apps/desktop/src/features/assistant/EditorScene.ts`. Any command added to the protocol must also be handled there.


### Mesh inspection and surface operations

Call `editor.inspect_mesh` before modifying geometry. `meshPath` is a child-index path relative to the scene object, for example `[0, 2]`; `[]` targets the object itself. Imported groups return up to 100 mesh parts and their paths, with `partsTruncated` when there are more or a path exceeds 32 levels. Select a part and inspect again. Path validity is checked in the editor; revision checks prevent using a path after the hierarchy changes.

Inspection additionally returns `modifiers`, `baseTriangles`, `skinned` and `morphTargets`. Successful inspection returns `status: ok`, statistics for render vertices, welded vertices, polygon faces, edges, source triangles, boundary edges, non-manifold edges, inconsistent edge winding, attribute names and material groups. `vertices`, `edges` and `faces` are paged independently using the same `offset` and `limit`. References use the full welded vertex/face index spaces, so samples may reference vertices or faces on another page. `localBounds` and column-major `matrixWorld` relate these local-space positions to the scene. These are geometric diagnostics, not a visual-quality or self-intersection check. Non-manifold vertex fans are additionally rejected when applying modifiers. An absent object returns `not_found`; a group target or unsupported source returns `unsupported` with a message and any discovered parts. Older editors may return no inspection support.

The editor welds position seams at relative tolerance 1e-7 (minimum 1e-10 local units), drops collapsed triangles and dissolves connected coplanar triangles into polygon control faces where the boundary is one loop with at most 256 corners. More complex regions retain triangles. Original authored quad topology cannot be recovered exactly from a triangulated import. Generated control polygons are retained for subsequent operations and reconstructed deterministically when command history is replayed.

Subdivision computes Catmull–Clark points and quads, with the 3/4 vertex + 1/8 of each boundary neighbor rule for open boundaries. Corner attributes such as UVs use those same masks on a continuous face-varying chart; a seam keeps each face's own corners instead of blending across it. Bevel offsets faces, connects them with edge strips, and fills local corner patches. Segments 2–8 sample a quadratic rounded edge profile; one segment is a flat chamfer. Concave and open manifold geometry is supported; boundary edges remain open, and a flat isolated face can remain geometrically unchanged. Overlapping widths and degenerate or non-manifold input are rejected. Global self-intersection detection, crease weights and automatic UV unwrapping remain unavailable.

Live stacks retain an independent base geometry. Legacy bevel/subdivision commands append entries (the command id becomes the modifier id, with a suffix if needed); `geometry.set_modifiers` replaces the full list. Enabled entries evaluate in order from the base. Clearing all entries restores the base; disabling an entry leaves it listed without evaluating it. Inspection exposes the ids and parameters. Stacks are copied into prepared candidates and rebuilt through saved history and undo/redo. There is no dedicated manual modifier panel yet.

Operations preserve face-varying UV seams and material assignments. Generated face points and vertices carry interpolation stencils for attributes and deformation. Skin joints retain the four strongest interpolated influences by magnitude, including negative corrective weights, normalized by their signed sum; influences beyond four are dropped. Relative and absolute morph positions are interpolated, morph normals are regenerated, and mesh skeleton bindings, target names and active influences remain intact. New bevel strips inherit an adjacent face's material; corner patches use a neighboring material and interpolated source values. This preserves usable texture coordinates but does not author an artist-controlled unwrap for new surfaces. Tangents are rebuilt when supplied with UVs. Custom numeric vertex attributes use linear interpolation; categorical or shader-specific attribute semantics are not inferred.

Only geometry modifier commands may share a batch (at most 20). Every replacement is evaluated before commit; a failed edit leaves both the current mesh and stack intact. Materials, hierarchy and transforms retain identity during ordinary direct geometry transactions; prepared commits replace the isolated scene as documented above. Shared render buffers still in use are retained. Private base buffers are released with the mesh.

Limits: 20,000 raw input triangles, 100,000 output triangles per mesh, 200,000 staged triangles per batch, eight stack entries, 1–3 levels per subdivision entry, 1–8 bevel segments, subdivision vertex valence at most 64, and a conservative 128 MiB output attribute budget. Generated cages retain polygon metadata for further evaluation within the output limit. Large or invalid inputs fail before committing scene changes. Inspection caching misses when position, index, skin, morph or any other vertex attribute changes.

## Scene objects

The editor snapshot lists objects with a `type`. The protocol allows `mesh`, `empty`, `collection`, `camera` and `light`. The desktop currently creates only `mesh` (primitives) and `empty` (groups). `visible` is included when the desktop reports it.

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
| `mesh-editing` | `editor.get_context`, `editor.inspect_mesh`, `modeling.generate_commands`, `editor.propose_commands`, `editor.apply_proposal`, `validation.check_scene` |

## Not exposed to the assistant

- **MCP tools.** `McpRegistry` (`modules/mcp/mcp.registry.ts`) is default-deny: a tool is usable only when its server is enabled and the tool is listed in `allowedTools`. No MCP tool is wired into the agent yet, so none appears in the inventory above.

## How a tool is wired

1. **Define.** Write the tool with `defineTool` in `apps/backend/src/modules/tools/<area>/<area>.tools.ts`. The name must match `namespace.snake_case` (`TOOL_NAME_PATTERN`).
2. **Register.** Add the tool to the list returned by the factory in `apps/backend/src/modules/tools/tools.module.ts`. Tools are listed as editor, validation, skills, procedural computation and planning. Plan steps are checked against every registered tool.
3. **Check.** `ToolRegistry` rejects an invalid or duplicate name at startup.
4. **Expose.** `createModelingCoordinatorDefinition` passes every registered tool to the agent and lists the provider names in the instructions (`modeling-coordinator.instructions.ts`).
