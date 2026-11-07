import { z } from "zod";
import { materialInspectionRequestSchema, measurementRequestSchema, meshInspectionRequestSchema } from "@movynta/editor-protocol";
import type { AgentRunContext } from "../../agent-runs/agent-runs.types.js";
import type { EditorBridge } from "../../editor-bridge/editor-bridge.types.js";
import { editorCommandListSchema } from "../../../shared/schemas/editor-command.schema.js";
import { defineTool, type ToolDefinition } from "../tool.types.js";
import type { EditorToolDependencies } from "./editor.types.js";
import { createPlacementTool } from "./placement.tools.js";
import { createDuplicationTool } from "./duplication.tools.js";

const identifier = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const noInput = z.object({}).strict();

/** Every editor tool first confirms the run's editor connection is still live for this user. */
function assertConnection(bridge: EditorBridge, context: AgentRunContext): void {
  bridge.assertConnection(context.userId, context.projectId, context.clientId);
}

export function createEditorTools(dependencies: EditorToolDependencies): ToolDefinition[] {
  const { bridge, proposals, getUnits } = dependencies;
  return [
    createPlacementTool(dependencies),
    createDuplicationTool(dependencies),
    defineTool({
      name: "editor.inspect_materials", permission: "read",
      description: "Read current material slots without parsing mesh topology. Supply objectId, meshPath (default []), offset and limit (1–100). Returns revision, materialSlotCount, and paged materials with slot index, name, shader type, editable flag, sRGB color/emissive, roughness, metalness, opacity, transparency, depthWrite, side and texture channel names. Standard and Physical material properties are editable while preserving imported maps/physical settings. Other shaders require explicit material.replace_slot. Group targets return available mesh parts. Use the returned revision for material proposals. No mutation or approval.",
      parameters: materialInspectionRequestSchema,
      execute: async (input, context) => {
        assertConnection(bridge, context);
        const scene = await bridge.getContext(context.clientId, { ...input, materialsOnly: true });
        const result = scene.meshInspection;
        return { revision: scene.revision, status: result?.status ?? "unsupported", materialSlotCount: result?.materialSlotCount ?? null,
          materials: result?.materials ?? [], parts: result?.parts ?? [], message: result?.message ?? (result?.materialSlotCount === undefined ? "Update the editor to support material inspection" : null) };
      },
    }),
    defineTool({
      name: "editor.measure", permission: "read",
      description: "Measure current geometry. dimensions returns exact evaluated triangle bounds, size and center in world or target-local axes, including descendants and hidden geometry by default. distance accepts world points or revision-bound mesh vertex references. edge accepts a canonical edge ID and revision. angle accepts from/at/to points or vertex references and returns degrees. clearance accepts first/second targets and method bounds (axis gaps, not a collision test) or surface (minimum boundary-surface distance, including intersections; containment can have positive distance). Surface searches are limited to 20000 triangles per target and a bounded work budget. Values are scene units. measurementUnits gives display and metersPerSceneUnit, or null for unitless. Use the returned revision for proposals. Re-measure after applying. Unavailable results explain unsupported inputs.",
      parameters: z.object({ request: measurementRequestSchema }).strict(),
      execute: async (input, context) => {
        assertConnection(bridge, context);
        const scene = await bridge.getContext(context.clientId, undefined, input.request);
        return { revision: scene.revision, units: getUnits ? getUnits(context.userId, context.projectId) : scene.measurementUnits ?? null,
          result: scene.measurement ?? { status: "unavailable", message: "Update the connected editor to support measurements" } };
      },
    }),
    defineTool({
      name: "editor.inspect_mesh", permission: "read",
      description: "Inspect mesh topology and local-space vertex/edge/face samples. Supply objectId, optional meshPath (a path to a mesh inside the object, [] for the object itself: each step is a part name such as 'Arm', 'Arm#1' for the second part with that name, or a child index; use the paths this tool returns, which give names wherever a part has one and so keep meaning the same part when others change), view ('base' or 'evaluated', default evaluated), offset and limit (1–100, default 25). Base inspects the unmodified cage; evaluated inspects the displayed mesh. To find faces efficiently, use faceQuery.normal (mesh-local direction), minDot (default 0.9), and/or mesh-local centerMin/centerMax. faceMatches returns IDs, total, offset and hasMore; faceQuery.limit is 1–1000, default 100. Set includeSamples false to omit vertex, edge and face pages. Example: faceQuery {normal:[0,1,0], minDot:0.95} finds upward-facing local faces. To close or join openings, set openings {} (optional offset, limit 1–50, default 20): it returns each opening as loops[] with edges (canonical edge IDs in walking order, at most 256, ready to pass whole to geometry.fill_hole, or two loops concatenated to geometry.bridge_edge_loops), edgeCount, truncated (true when the loop has more edges than listed, so it cannot be passed whole), and its center/min/max, plus total, hasMore and irregularEdges (boundary edges not in a simple loop). To find the separate parts of a mesh, set shells {}: it returns shells[] with faceCount, firstFace (a face ID that names the whole part, for geometry.flip_normals), closed, center/min/max, plus total and hasMore. Use view base for IDs you will edit with. Use returned IDs only with that view and revision. Imported groups return mesh paths. Evaluated faces may carry baseFaceIndex when their source is known. Source meshes above 20000 triangles may be unsupported. Nothing changes.",
      parameters: meshInspectionRequestSchema,
      execute: async (input, context) => {
        assertConnection(bridge, context);
        const scene = await bridge.getContext(context.clientId, input);
        return { revision: scene.revision, inspection: scene.meshInspection ?? null, message: scene.meshInspection ? null : "This editor does not support mesh inspection" };
      },
    }),
    defineTool({
      name: "editor.get_context",
      description: "Read the editor scene and revision. designFocus includes Edit-mode picks. When modifiersEnabled is true, ids name the display mesh. For face picks, baseFaceIds contains the distinct base faces only when every pick has a known source. A mapped edit affects the whole source face, including unpicked display fragments. Use baseFaceIds with componentView base and expectedRevision from this context. If the mapping is absent, identify components through a base inspection.",
      permission: "read",
      parameters: noInput,
      execute: (_input, context) => {
        assertConnection(bridge, context);
        return bridge.getContext(context.clientId);
      },
    }),

    defineTool({
      name: "editor.get_scene_summary",
      description: "Summarise the current scene: object counts by type, selection, and revision.",
      permission: "read",
      parameters: noInput,
      execute: async (_input, context) => {
        assertConnection(bridge, context);
        const scene = await bridge.getContext(context.clientId);
        const countsByType: Record<string, number> = {};
        for (const object of scene.objects) {
          countsByType[object.type] = (countsByType[object.type] ?? 0) + 1;
        }
        return {
          revision: scene.revision,
          activeSceneName: scene.activeSceneName,
          objectCount: scene.objects.length,
          countsByType,
          selectedObjectIds: scene.selectedObjectIds,
        };
      },
    }),

    defineTool({
      name: "editor.propose_commands",
      description: [
        "Submit a batch of structured scene commands for preview. A proposal alone does not request approval or show an approval card. After a successful proposal, call editor.apply_proposal with the returned proposalId. Proposals apply automatically without a user approval prompt. Nothing changes until the apply call.",
        "Commands run in order, and later commands may use objects created earlier in the same batch.",
        "Change existing objects with scene.rename_object, scene.set_visibility and scene.set_parent instead of recreating them.",
        "Use editor.plan_duplicates to create independent hierarchy copies or linear object arrays with fresh root and descendant IDs. Propose its scene.duplicate_hierarchy command at expectedRevision: sourceRevision in its own proposal. Each copy retains the source parent and collection memberships, with offset multiplied by its 1-based copy index in parent or world space. Geometry, material instances, modifier base cages and skeletons are independent; texture assets remain shared. Copied internal Boolean operands remap to the same copy; external operands remain linked and cuts reevaluate. Limits: 63 additional copies, 2000 scene objects and the 128 MiB geometry budget.",
        "For live mesh arrays and editable symmetry, use geometry.set_modifiers with kind array or mirror. Array uses count 1–64 including the source, and nonzero mesh-local offset [x,y,z] per instance; copies are separate control islands, without merging. Mirror uses axis x/y/z, local plane coordinate origin (default 0), bisect (default true), keepSide positive/negative (default positive) and mergeDistance 0–1 (default 1e-6). It keeps/bisects one side, reflects it with reversed face winding, welds plane vertices and preserves per-corner attributes. Bisect supports convex intersected faces; an unbisected source must lie on the chosen side. Open faces on the plane, invalid topology, skin/morph deformation and oversized output are rejected. Removing/disabling modifiers restores the base, and base edits regenerate repetitions. This is live geometric symmetry, not interactive movement clipping or Boolean union. Preserve existing stack entries and use inspected base IDs/revisions for component edits.",
        "Use editor.inspect_materials before material changes. material.set_properties edits one existing Standard/Physical slot and preserves imported texture maps/physical parameters. Properties: name, sRGB color/emissive #RRGGBB, roughness/metalness/opacity 0–1, emissiveIntensity 0–100, side front/back/double, depthWrite. Setting opacity toggles transparent below 1; depthWrite changes only when specified. material.add_slot appends a new Standard material at slot equal to materialSlotCount (up to 256 slots). It does not assign the new slot to faces. material.replace_slot explicitly replaces an existing shader with a new Standard material and discards its imported maps/settings. Use a separate batch of at most 20 property/slot commands with expectedRevision from inspection. Do not replace imported shaders merely to edit a supported property.",
        "material.assign assigns an existing slot to unique base face ids, or all base faces when ids is omitted. Inspect the base cage for IDs and pass expectedRevision. Assignment uses a separate component-edit proposal after slot creation, preserves geometry/attributes, and reevaluates enabled modifiers and Boolean dependencies. All material changes apply automatically with strict revisions and saved undo/redo. New texture creation/import, UV authoring and node shaders are not available yet.",
        "Collections organize the scene and hide together; they never move anything. scene.create_collection makes one (collectionId, name, optional parentCollectionId to nest it), scene.rename_collection, scene.set_collection_visibility and scene.move_collection (parentCollectionId, or null for the top) change one, and scene.delete_collection removes one only when nothing is in it. scene.move_to_collection puts an object in a collection (collectionId, or null for the scene itself) together with everything that hangs below it unless includeChildren is false; it keeps the object's place and parent. geometry.create_primitive, geometry.create_mesh and scene.create_object accept collectionId; left out, a new object joins its parent's collection, else the scene itself. An object is in exactly one collection. Collection ids are separate from object ids, and a name that a collection in the same place already has is made unique with a number, reported in the apply result. A hidden collection hides what is in it and in the collections inside it, but not an object's own visibility flag: showing the collection again shows only what was not hidden on its own.",
        "scene.transform_object sets an object's position, rotation or scale to the values given. scene.move_object adds delta [x,y,z] to the position the object has when the command runs, along its parent's axes, so use it for \"move it up by 2\": it keeps a move the user made after you read the scene, which an absolute position would overwrite. Neither moves the children separately; they follow their parent.",
        "scene.set_parent keeps the object where it is in the world. That is refused when the object's new place could not be stored as a position, rotation and scale: when something above it or above the new parent is scaled by different amounts on different axes and the object is turned relative to it, or when a scale is 0. Give the group the same scale on every axis, or create the part under the group with parentId instead of moving it there.",
        "geometry.bevel appends a live bevel with mesh-local width, 1–8 segments, profile chamfer, round (default), or circular, and minimum crease angle 0–180 degrees. Use circular with 3–4 segments for rounded corners. Coplanar edges are skipped. geometry.subdivide appends a live modifier with levels 1–3 and method catmull-clark (default), linear, or loop. geometry.set_modifiers replaces the ordered stack of at most eight entries, with unique ids and enabled flags. Inspect existing entries and preserve their ids and parameters.",
        "geometry.boolean appends a live difference (default), union, or intersect. Supply objectId, optional meshPath, operandObjectId and optional operandMeshPath (paths as editor.inspect_mesh returns them, by part name where parts have one). Both inputs must be closed solids and the operand must already exist. The operand stays in the scene. Use editor.inspect_mesh stats.materialSlots to validate the zero-based cutMaterialIndex for cutter faces. UVs and vertex colors are interpolated. Create and position the cutter first, then batch geometry.boolean followed by geometry.bevel to round the cut. An operand path written with indexes is stored by part name where the part has one, so the boolean keeps using the same part when parts of an imported model are added, removed or reordered. Modifier batches accept at most 20 commands and use strict revisions and automatic application.",
        "geometry.extrude rewrites the base cage. Supply kind, ids, and exactly one of nonzero mesh-local offset or signed normalDistance (faces only). normalMode region moves the cap along its average normal, vertex moves the shared cap vertices along their normals, and individual extrudes each face separately. Faces support capScale or capScaleXY, capRotationDegrees in mesh-local XYZ, and twistDegrees about the extrusion axis. steps repeats a face extrusion 1–16 times, applying the same parameters to each new cap. closeOpenSurface closes an entire open planar sheet with a region-normal extrusion. Use verified base IDs and expectedRevision when passing componentView base.",
        "geometry.transform_faces moves shared cage vertices without changing topology. Supply face ids and transform.position (delta), transform.rotation (XYZ radians), or transform.scale (per-axis factors 0.001–100). Scale and rotate around the selected vertices' centroid. space defaults to local and can be world. With enabled modifiers, use verified base IDs, componentView base and expectedRevision. Batch up to 20 component edits with extrusion, hole fill, or selected-face subdivision. These commands apply automatically.",
        "geometry.transform_components moves, rotates or scales base vertices or edges without adding topology. kind is vertex or edge; ids are unique welded vertex IDs or canonical a_b edge IDs (a < b) from a base inspection. componentView is always base. Pass expectedRevision from that inspection. space is local (default) or world; optional pivot is an absolute point in that space, otherwise use the unique selected vertices' centroid. Apply scale, XYZ-radian rotation, then translation delta in that space. Shared edge endpoints move once. Enabled modifiers reevaluate; a live extrusion must keep its anchor faces unchanged. Never use evaluated component IDs.",
        "geometry.knife_path applies 1–64 knife segments atomically; each segment refers to topology after previous segments (so predicting the IDs is error-prone: prefer geometry.bisect for a straight cut through a region). The whole path is checked once at the end and a failure names the segment. Each cut has the same planar-face and boundary endpoint restrictions as knife_chord. geometry.knife_chord splits one planar base face between boundary points. Supply face ID and start/end {vertex} or {edge, factor}; edge factors run from the lower to higher numbered vertex and must be strictly within (1e-8, 1-1e-8). The cut cannot follow an existing boundary edge. It splits neighboring faces to preserve connectivity and corner attributes; nonplanar affected faces and non-affine UV, color or deformation detail are rejected. It does not implement multi-face strokes. Use one command, inspect the base cage and require expectedRevision, disable modifiers and remove live extrusion. geometry.correct_normals makes winding consistent per connected shell and rebuilds shading normals; mode consistent preserves each shell first face direction, outward orients closed shells outward independently including cavity shells, while open shells retain their first face direction. Non-manifold or ambiguous results are rejected; cage reconstruction may omit collapsed triangles. Use a single command, disable modifiers and remove live extrusion. geometry.remove_duplicate_faces removes identical face loops across the base mesh when winding, material and corner attributes match; conflicting overlaps or invalid output are rejected. Cage reconstruction may omit collapsed triangles. Use one command per proposal, disable modifiers and remove live extrusion. geometry.merge_by_distance merges connected groups among 2–4096 base vertex ids linked within a positive mesh-local distance up to 100; each group moves to its average. Use one command per proposal, disable modifiers and remove live extrusion. geometry.merge_vertices collapses 2–4096 unique base vertex ids to mode center (default), first or last in the supplied ID order; corner attributes interpolate per surviving face. geometry.dissolve_edges removes selected internal coplanar edges, refusing material/UV seams, holes, pinched boundaries or non-affine attributes that would be lost. Select all internal edges of each region. geometry.loop_cut takes one canonical base edge, cuts 1–16 (default 1), and factor strictly between 0 and 1 (default 0.5); offset factor applies only to a single cut. It follows opposite edges through a quad strip, stopping at open boundaries, and rejects nonquad interruptions or crossing/inconsistent rings. These three operations change IDs: use exactly one command per proposal, disable enabled modifiers, remove live extrusion, and inspect the result before editing again.",
        "geometry.bisect cuts a base mesh part with a flat plane (Blender's Bisect) and is the easiest accurate way to cut: no edge IDs or factors. plane is {axis:\"x\"|\"y\"|\"z\", offset} (the plane axis = offset) or {point:[x,y,z], normal:[x,y,z]}; space is local (default, the mesh-local coordinates editor.inspect_mesh reports) or world. Every polygon the plane crosses is split and each crossed edge gets one shared new vertex, so the mesh stays watertight; concave polygons and planes through existing vertices, edges or faces are handled exactly. keep is both (default, only cuts), positive (the side the normal points to) or negative, and removes the other side; fill (needs keep) caps the opening with flat polygons so a solid stays closed; a cap can be cut again, so two filled cuts (each its own proposal, inspecting between them) cut a block into a quarter. ids limits the cut to those base faces (not with keep). snapDistance (mesh-local) treats near-plane vertices as on the plane. A plane that misses the mesh is refused with the distance range of the mesh from the plane. Cut faces must be planar with affine UV/color/deformation; triangulate a bent face first. Face IDs shift up after a cut (pieces are consecutive) and new vertices are last; inspect again. geometry.delete_components deletes base kind face, edge or vertex ids (an edge or vertex takes every face that touches it), drops vertices no face uses, keeps the order of what remains, may open a closed mesh, and refuses to remove everything (use scene.delete_object) or to leave faces touching only at a vertex; follow it with geometry.fill_hole to close the gap. geometry.flip_normals reverses whole connected surfaces: omit ids for all, or list base faces and each surface containing one flips as a whole (IDs unchanged). geometry.triangulate_faces splits polygons into triangles in place (omit ids for all) and keeps materials and attributes. bisect, delete_components and triangulate_faces renumber components: send one per proposal with expectedRevision from a base inspection, disable enabled modifiers and remove live extrusion first.",
        "geometry.set_shading changes how a base mesh part is shaded: mode flat (a normal per face) or smooth, with an optional angle in degrees (smooth only) that keeps edges bent more than the angle crisp, so a cylinder is round around its side and crisp at its caps. Shape and IDs are unchanged and later base edits keep the choice, so set it once, in any order. geometry.bridge_edge_loops joins two closed openings with quads: ids are the canonical edge IDs of every edge of both boundary loops (each edge has one face), the loops need at least three edges each and no shared vertex (unequal counts are fine: quads where both loops advance, triangles spread evenly for the extra edges), twist (whole edges, default 0) turns the automatic pairing if the connecting edges cross; existing IDs stay and new faces are last; loops already joined by faces are refused. geometry.separate_faces moves base faces ids into a new object newObjectId (fresh ID, optional name) that is a sibling of the source with the same parent, collection, transform and its own copy of every material slot; the source keeps the other faces. It refuses all faces, faces that touch only at a corner, skinned meshes, a non-empty meshPath and a mesh with modifiers (clear them first); send it alone with expectedRevision from a base inspection and inspect the source again afterward.",
        "geometry.slide_edges moves selected edge endpoints along explicit rails [{vertex,toward}], with one rail per unique selected vertex and factor strictly between 0 and 1. Each toward must be an unselected vertex connected by an existing edge; choose the other neighboring rail to slide the opposite way. Coordinates are mesh-local. Connectivity and vertex/corner attributes stay attached to their original IDs; this is geometric sliding without UV correction. All four operations use componentView base and require expectedRevision from base inspection. Invalid geometry is rejected atomically. They apply automatically and are saved for undo/redo.",
        "For adjustable extrusion, use geometry.set_modifiers with a first entry of kind extrusion, id, enabled, ids, baseKey from editor.inspect_mesh with view base, and signed normalDistance (-100 to 100, nonzero). Optional capScale, twistDegrees and closeOpenSurface work like face extrusion. Preserve the remaining modifiers, and pass the base inspection revision as expectedRevision. A stale baseKey is rejected. Hole fill and base edits that preserve the anchored face polygons can retain the modifier. Face transforms and extrusions with explicit base face IDs are validated against those anchors. Other base edits require removing it first.",
        "Face extrusion supports normalMode individual for separate face normals. Adjacent coplanar faces require region mode. Use capScaleXY instead of capScale to scale along two axes perpendicular to the displacement, or capRotationDegrees for mesh-local XYZ rotation before twist. Live extrusion accepts the same shaping options for faces, or use componentKind edge or vertex with offset instead of normalDistance.",
        "geometry.fill_hole closes one simple boundary loop. Nonplanar loops require a simple projection and are triangulated. Supply objectId, optional meshPath and 3–256 canonical boundary edge IDs from editor.inspect_mesh. With modifiers enabled, inspect view base, set componentView to base and pass the inspection revision as expectedRevision. Applies automatically and can share a component edit batch.",
        "geometry.subdivide_faces splits the listed base faces into quads and inserts shared edge midpoints into neighboring faces. Disable enabled modifiers first. It requires a strict revision, and can share a batch with other component edits (at most 20 commands).",
        "geometry.inset_faces builds a border around selected base faces. Provide face ids from editor.inspect_mesh and a nonnegative mesh-local thickness, with optional signed depth along vertex normals. Use individual for separate borders or outset to create the border in neighboring faces. Optional flags are boundary, offsetEven, offsetRelative, edgeRail, selectOuter and interpolate. Disable enabled modifiers first. Inset requires a strict revision, and can share a batch with other component edits.",
        "geometry.bevel_edges bevels selected base-cage crease edges using canonical edge ids from editor.inspect_mesh, positive mesh-local width, 1–32 segments, and profile chamfer, round or circular. trimEndFaces is on unless you set it to false, so the face at each end of a beveled edge (one edge of a box, a seam of a cylinder) is cut back to meet the bevel; turned off, that face keeps its sharp corner and extra faces overlap it. It makes no difference for a closed loop of edges. Disable enabled modifiers first. Boundary and coplanar edges and selections ending partway along a straight edge are unsupported. Use one command per batch and a strict revision.",
        "geometry.create_primitive creates a box, sphere, cylinder, cone, torus, plane, tetrahedron, octahedron or icosahedron. Give a fresh objectId and size. Optional name (the kind of shape when left out), parentId (an existing object, or one created earlier in the batch) and transform (position, rotation, scale local to the parent) create, name, parent and place the shape in one command; they cannot be combined with replaceExisting. A name that a sibling under the same parent already has is made unique with a number such as .001, and editor.apply_proposal returns the name each object received. Optional options specify mesh-local dimensions and density: box width/height/depth, plane width/height, sphere radius/widthSegments/heightSegments, cylinder radiusTop/radiusBottom/height/radialSegments/heightSegments, cone radius/height/radialSegments/heightSegments, torus radius/tube/radialSegments/tubularSegments, and polyhedra radius/detail 0–4. Unspecified fields retain the size-based defaults. Dimensions are positive and at most 100, cylinder radii may be zero individually, segments are bounded and the resulting mesh must fit 20000 triangles. Example: a tapered cylinder uses options {radiusTop:0.5,radiusBottom:1,height:3,radialSegments:32}. Do not call scene.create_object first for the same objectId.",
        "geometry.create_mesh creates a new mesh with a fresh objectId, optional name, optional parentId and transform (local to the parent), vertices as mesh-local [x,y,z] arrays, and faces as arrays of zero-based vertex indices in consistent winding order. shading is flat (default) or smooth. Limits: 3–4096 vertices, 1–4096 faces, 3–64 distinct indices per face, coordinates within ±10000, and at most 20000 triangles. Every vertex must be used; coincident vertices must share an index. The editor rejects degenerate, non-manifold and inconsistent surfaces. Open boundaries are allowed. Use modeling.generate_commands to construct arrays compactly, and preview from multiple views before applying. Global self-intersection detection and UV authoring are unavailable. Use separate material commands for appearance.",
        "scene.create_object makes an empty group or parent, optionally under parentId. Group the parts of one thing under such a parent so that moving the group moves them all. replaceExisting true on geometry.create_primitive changes the shape of an object that already exists.",
        "If the proposal is rejected, the error lists each problem with the commandId and how to fix it; correct those commands and propose again.",
        "If the user changes the request while a proposal still waits, send the new batch with supersedes set to that proposal's id; it replaces the waiting one.",
        "stepId names the step of the latest plan that this batch carries out.",
        "For calculated commands, pass expectedRevision from modeling.generate_commands.sourceRevision. Such proposals fail if the scene changes before proposal or application; regenerate instead of rebasing.",
      ].join(" "),
      permission: "propose",
      parameters: z
        .object({
          summary: z.string().min(1).max(300),
          commands: editorCommandListSchema,
          expectedRevision: z.number().int().nonnegative().optional(),
          supersedes: identifier.optional(),
          stepId: identifier.optional(),
        })
        .strict(),
      execute: async (input, context) => {
        assertConnection(bridge, context);
        const latestPlan = context.progress.plans.at(-1);
        const steps = latestPlan?.steps ?? [];
        const planStep = input.stepId === undefined ? undefined : steps.find((step) => step.id === input.stepId);
        if (input.stepId !== undefined && !planStep) {
          return {
            status: "rejected",
            reason: "stepId does not match a step of the latest plan. Record a plan first, or leave stepId out.",
            availableStepIds: steps.map((step) => step.id),
          };
        }
        const proposal = await proposals.propose(
          { id: context.runId, userId: context.userId, projectId: context.projectId, clientId: context.clientId },
          { summary: input.summary, commands: input.commands, supersedes: input.supersedes, expectedRevision: input.expectedRevision },
        );
        context.progress.proposals.push({ id: proposal.id, ...(planStep ? { stepId: planStep.id } : {}) });
        context.events.emit("editor.proposal.created", {
          proposalId: proposal.id,
          summary: proposal.summary,
          requiresApproval: proposal.requiresApproval,
          commandCount: proposal.commands.length,
          baseRevision: proposal.baseRevision,
          supersedes: input.supersedes ?? null,
          planStepId: planStep?.id ?? null,
        });
        return {
          proposalId: proposal.id,
          status: proposal.status,
          requiresApproval: proposal.requiresApproval,
          commandCount: proposal.commands.length,
          baseRevision: proposal.baseRevision,
          supersedes: input.supersedes ?? null,
          planStep: planStep ? { id: planStep.id, title: planStep.title } : null,
          nextAction: "Call editor.apply_proposal with this proposalId to apply automatically.",
        };
      },
    }),

    defineTool({
      name: "editor.apply_proposal",
      description: [
        "Apply a previously proposed batch automatically, including destructive and large batches. Ownership, validation and revision checks remain enforced.",
        "If the scene changed since the proposal was made, the batch runs again on the new scene when every command still fits;",
        "the result then has rebased true. Otherwise the result is failed and the batch must be proposed again.",
        "Each entry of results may carry name, the name an object received from a command that created, renamed or re-parented it; a name already used by a sibling gets a number.",
      ].join(" "),
      permission: "apply",
      parameters: z.object({ proposalId: identifier }).strict(),
      // Also applies proposals stored before automatic approval was enabled. Unknown IDs fail in apply.
      requiresApproval: () => false,
      execute: async (input, context) => {
        assertConnection(bridge, context);
        const result = await proposals.apply(
          { id: context.runId, userId: context.userId, projectId: context.projectId, clientId: context.clientId },
          input.proposalId,
        );
        // The scene now differs from the last check, so the run must check it again before it can finish.
        if (result.status === "applied") {
          context.progress.unverifiedChanges = true;
          context.progress.brief.stale = true;
          const quality = context.progress.quality;
          quality.changes += 1;
          quality.captureRevision = null;
          quality.viewpoints = [];
          quality.outcome = null;
          quality.summary = "";
        }
        return {
          proposalId: result.proposalId,
          status: result.status,
          revision: result.revision ?? null,
          results: result.results,
          message: result.message ?? null,
          rebased: result.rebased ?? false,
        };
      },
    }),
  ];
}
