import type { EditorCommand } from "@movynta/editor-protocol";

export type EditorCommandType = EditorCommand["type"];

/** What the model reads about one command: a line for the index, and the full rules on request. */
export interface CommandNotes {
  /** One line, shown for every command in editor.propose_commands: what it does and its main fields and limits. */
  readonly summary: string;
  /** Everything else that decides whether the command works, returned by editor.describe_commands. */
  readonly rules: string;
}

/**
 * The reference for every editor command. Keyed by command type, so a command added to the protocol without an entry
 * here does not compile. The JSON schema the model receives gives fields and types but not ranges or behaviour, so
 * limits that matter are stated in these words.
 */
export const COMMAND_REFERENCE: Readonly<Record<EditorCommandType, CommandNotes>> = {
  "scene.create_object": {
    summary: "An empty group or parent: objectId, optional name, parentId, transform, collectionId.",
    rules: "Group the parts of one thing under such a parent so that moving the group moves them all. Do not call it first for an objectId that geometry.create_primitive or geometry.create_mesh will create. Keep a group's scale the same on every axis.",
  },
  "scene.transform_object": {
    summary: "Sets position, rotation (XYZ radians) or scale to the values given, in the parent's space. Scale must be positive.",
    rules: "Absolute: it overwrites a move the user made after you read the scene, so for \"move it up by 2\" use scene.move_object. Children follow their parent; they are not moved separately.",
  },
  "scene.move_object": {
    summary: "Adds delta [x,y,z] (nonzero, each within ±100000) to the position along the parent's axes.",
    rules: "It adds to the position the object has when the command runs, so it keeps a move the user made after you read the scene. Children follow their parent.",
  },
  "scene.delete_object": {
    summary: "Deletes one object. Delete its children first, deepest first.",
    rules: "Change an object with scene.rename_object, scene.set_visibility or scene.set_parent instead of deleting and recreating it.",
  },
  "scene.rename_object": {
    summary: "Renames an object (1–80 characters).",
    rules: "A name a sibling already has gets a number such as .001; the apply result gives the name each object received.",
  },
  "scene.set_visibility": {
    summary: "Shows or hides one object (visible true/false).",
    rules: "A hidden collection hides what is in it, but not an object's own flag: showing the collection again shows only what was not hidden on its own.",
  },
  "scene.set_parent": {
    summary: "Moves an object under another object, or to the top level with null, keeping where it is in the world.",
    rules: "Refused when the object's new place could not be stored as a position, rotation and scale: when something above it or above the new parent is scaled by different amounts on different axes and the object is turned relative to it, or when a scale is 0. Give the group the same scale on every axis, or create the part under the group with parentId instead of moving it there.",
  },
  "scene.duplicate_hierarchy": {
    summary: "Independent copies of an object and its descendants. Get it from editor.plan_duplicates and propose its planId; alone in its proposal.",
    rules: "Use editor.plan_duplicates to create independent hierarchy copies or linear object arrays with fresh root and descendant IDs, and propose its planId, which carries expectedRevision: sourceRevision. Each copy retains the source parent and collection memberships, with offset multiplied by its 1-based copy index in parent or world space. Geometry, material instances, modifier base cages and skeletons are independent; texture assets remain shared. Copied internal Boolean operands remap to the same copy; external operands remain linked and cuts reevaluate. Limits: 63 additional copies, 2000 scene objects and the 128 MiB geometry budget. For live mesh arrays use geometry.set_modifiers with kind array instead.",
  },
  "scene.create_collection": {
    summary: "A collection: collectionId, name, optional parentCollectionId to nest it.",
    rules: "Collections organize the scene and hide together; they never move anything. Collection ids are separate from object ids, and a name that a collection in the same place already has is made unique with a number, reported in the apply result. geometry.create_primitive, geometry.create_mesh and scene.create_object accept collectionId; left out, a new object joins its parent's collection, else the scene itself. An object is in exactly one collection.",
  },
  "scene.rename_collection": {
    summary: "Renames a collection.",
    rules: "A name that a collection in the same place already has is made unique with a number, reported in the apply result.",
  },
  "scene.set_collection_visibility": {
    summary: "Shows or hides a collection and the collections inside it.",
    rules: "A hidden collection hides what is in it and in the collections inside it, but not an object's own visibility flag: showing the collection again shows only what was not hidden on its own.",
  },
  "scene.move_collection": {
    summary: "Nests a collection under parentCollectionId, or null for the top.",
    rules: "A collection cannot sit inside itself.",
  },
  "scene.delete_collection": {
    summary: "Removes a collection, only when nothing is in it.",
    rules: "Move what is in it out with scene.move_to_collection first.",
  },
  "scene.move_to_collection": {
    summary: "Puts an object in collectionId (null for the scene itself), with everything below it unless includeChildren is false.",
    rules: "It keeps the object's place and parent. An object is in exactly one collection.",
  },
  "material.set_properties": {
    summary: "Edits one existing Standard/Physical slot: name, color/emissive #RRGGBB, roughness/metalness/opacity 0–1, emissiveIntensity 0–100, side, depthWrite.",
    rules: "Use editor.inspect_materials first. It preserves imported texture maps and physical parameters. Colors are sRGB. Setting opacity toggles transparent below 1; depthWrite changes only when specified. Do not replace imported shaders merely to edit a supported property. Material property/slot commands go in a batch of their own of at most 20, with expectedRevision from the inspection; they apply automatically with strict revisions and saved undo/redo. New texture creation/import, UV authoring and node shaders are not available yet.",
  },
  "material.add_slot": {
    summary: "Appends a new Standard material at slot = materialSlotCount (up to 256 slots); assigns no faces.",
    rules: "Create slots in their own batch (at most 20 property/slot commands, expectedRevision from editor.inspect_materials), then assign faces with material.assign in a following proposal.",
  },
  "material.replace_slot": {
    summary: "Replaces an existing shader with a new Standard material, discarding its imported maps and settings.",
    rules: "Use it only when the user wants the shader replaced; do not replace imported shaders merely to edit a supported property (use material.set_properties). Batch of its own of at most 20 property/slot commands, with expectedRevision from editor.inspect_materials.",
  },
  "material.assign": {
    summary: "Assigns an existing slot to unique base face ids, or all base faces when ids is omitted.",
    rules: "Inspect the base cage for IDs and pass expectedRevision. It is a component edit: a separate proposal after slot creation. It preserves geometry and attributes, and reevaluates enabled modifiers and Boolean dependencies. Reinspect after applying.",
  },
  "geometry.create_primitive": {
    summary: "box, sphere, cylinder, cone, torus, plane, tetrahedron, octahedron or icosahedron: fresh objectId, size, optional name, parentId, transform, collectionId, options.",
    rules: "Optional name (the kind of shape when left out), parentId (an existing object, or one created earlier in the batch) and transform (position, rotation, scale local to the parent) create, name, parent and place the shape in one command; they cannot be combined with replaceExisting. replaceExisting true changes the shape of an object that already exists. A name that a sibling under the same parent already has is made unique with a number such as .001, and the apply result returns the name each object received. Optional options specify mesh-local dimensions and density: box width/height/depth, plane width/height, sphere radius/widthSegments/heightSegments, cylinder radiusTop/radiusBottom/height/radialSegments/heightSegments, cone radius/height/radialSegments/heightSegments, torus radius/tube/radialSegments/tubularSegments, and polyhedra radius/detail 0–4. Unspecified fields retain the size-based defaults. Dimensions are positive and at most 100, cylinder radii may be zero individually, segments are bounded (3–128, heightSegments 1–128) and the resulting mesh must fit 20000 triangles. Example: a tapered cylinder uses options {radiusTop:0.5,radiusBottom:1,height:3,radialSegments:32}. Do not call scene.create_object first for the same objectId.",
  },
  "geometry.create_mesh": {
    summary: "A custom polygon mesh: fresh objectId, mesh-local vertices [x,y,z], faces as vertex-index lists, optional name, parentId, transform, shading.",
    rules: "Faces are arrays of zero-based vertex indices in consistent winding order. shading is flat (default) or smooth. Limits: 3–4096 vertices, 1–4096 faces, 3–64 distinct indices per face, coordinates within ±10000, and at most 20000 triangles. Every vertex must be used; coincident vertices must share an index. The editor rejects degenerate, non-manifold and inconsistent surfaces. Open boundaries are allowed. Use modeling.generate_commands or modeling.propose_generated to construct arrays compactly, and preview from multiple views before applying. Global self-intersection detection and UV authoring are unavailable. Use separate material commands for appearance.",
  },
  "geometry.bevel": {
    summary: "Appends a live bevel modifier: mesh-local width, 1–8 segments, profile chamfer/round/circular, minimum crease angle 0–180°.",
    rules: "round is the default profile. Use circular with 3–4 segments for rounded corners. Coplanar edges are skipped. Batch geometry.boolean followed by geometry.bevel to round a cut. Modifier batches accept at most 20 commands and use strict revisions.",
  },
  "geometry.subdivide": {
    summary: "Appends a live subdivision modifier: levels 1–3, method catmull-clark (default), linear or loop.",
    rules: "Modifier batches accept at most 20 commands and use strict revisions.",
  },
  "geometry.set_modifiers": {
    summary: "Replaces the ordered live stack (at most 8 entries, unique ids, enabled flags): bevel, subdivision, boolean, array, mirror, extrusion.",
    rules: "Inspect existing entries and preserve their ids and parameters. Array uses count 1–64 including the source, and nonzero mesh-local offset [x,y,z] per instance; copies are separate control islands, without merging. Mirror uses axis x/y/z, local plane coordinate origin (default 0), bisect (default true), keepSide positive/negative (default positive) and mergeDistance 0–1 (default 1e-6). It keeps/bisects one side, reflects it with reversed face winding, welds plane vertices and preserves per-corner attributes. Bisect supports convex intersected faces; an unbisected source must lie on the chosen side. Open faces on the plane, invalid topology, skin/morph deformation and oversized output are rejected. This is live geometric symmetry, not interactive movement clipping or Boolean union. Removing/disabling modifiers restores the base, and base edits regenerate repetitions. For adjustable extrusion, use a first entry of kind extrusion with id, enabled, ids, baseKey from editor.inspect_mesh with view base, and signed normalDistance (-100 to 100, nonzero); optional capScale, capScaleXY, capRotationDegrees, twistDegrees and closeOpenSurface work like face extrusion, or use componentKind edge or vertex with offset instead of normalDistance. Pass the base inspection revision as expectedRevision. A stale baseKey is rejected. Hole fill and base edits that preserve the anchored face polygons can retain the extrusion; face transforms and extrusions with explicit base face IDs are validated against those anchors; other base edits require removing it first. Modifier batches accept at most 20 commands.",
  },
  "geometry.boolean": {
    summary: "Appends a live difference (default), union or intersect with operandObjectId (optional meshPath, operandMeshPath, cutMaterialIndex).",
    rules: "Paths are as editor.inspect_mesh returns them, by part name where parts have one; an operand path written with indexes is stored by part name where the part has one. Both inputs must be closed solids and the operand must already exist; create and position the cutter first, in an earlier proposal. The operand stays in the scene. Use editor.inspect_mesh stats.materialSlots to validate the zero-based cutMaterialIndex for cutter faces. UVs and vertex colors are interpolated. Batch geometry.boolean followed by geometry.bevel to round the cut. Modifier batches accept at most 20 commands and use strict revisions.",
  },
  "geometry.extrude": {
    summary: "Extrudes base faces, edges or vertices: kind, ids, and exactly one of nonzero mesh-local offset or signed normalDistance (faces only).",
    rules: "It rewrites the base cage. normalMode region moves the cap along its average normal (adjacent coplanar faces require it), vertex moves the shared cap vertices along their normals, and individual extrudes each face separately. Faces support capScale or capScaleXY (two axes perpendicular to the displacement), capRotationDegrees in mesh-local XYZ (before twist), and twistDegrees about the extrusion axis. steps repeats a face extrusion 1–16 times, applying the same parameters to each new cap. closeOpenSurface closes an entire open planar sheet with a region-normal extrusion. Use verified base IDs and expectedRevision from a base inspection.",
  },
  "geometry.transform_faces": {
    summary: "Moves, rotates or scales base faces without changing topology: ids and transform position (delta) / rotation (XYZ radians) / scale (0.001–100).",
    rules: "Moves the shared cage vertices. Scale and rotate around the selected vertices' centroid. space defaults to local and can be world. With enabled modifiers, use verified base IDs, componentView base and expectedRevision.",
  },
  "geometry.transform_components": {
    summary: "Moves, rotates or scales base vertices or edges without adding topology: kind vertex/edge, ids, transform, optional space and pivot.",
    rules: "ids are unique welded vertex IDs or canonical a_b edge IDs (a < b) from a base inspection; componentView is always base; pass expectedRevision from that inspection. space is local (default) or world; optional pivot is an absolute point in that space, otherwise the unique selected vertices' centroid. Applies scale, XYZ-radian rotation, then translation delta in that space. Shared edge endpoints move once. Enabled modifiers reevaluate; a live extrusion must keep its anchor faces unchanged. Never use evaluated component IDs.",
  },
  "geometry.fill_hole": {
    summary: "Closes one simple boundary loop: 3–256 canonical boundary edge ids.",
    rules: "Nonplanar loops require a simple projection and are triangulated. With modifiers enabled, inspect view base, set componentView to base and pass the inspection revision as expectedRevision. Use it after geometry.delete_components to close the gap.",
  },
  "geometry.subdivide_faces": {
    summary: "Splits the listed base faces into quads, inserting shared edge midpoints into neighbouring faces.",
    rules: "Disable enabled modifiers first. It requires a strict revision.",
  },
  "geometry.inset_faces": {
    summary: "Builds a border around base faces: ids, nonnegative mesh-local thickness, optional signed depth along vertex normals.",
    rules: "Use individual for separate borders or outset to create the border in neighbouring faces. Optional flags are boundary, offsetEven, offsetRelative, edgeRail, selectOuter and interpolate. Disable enabled modifiers first. It requires a strict revision.",
  },
  "geometry.bevel_edges": {
    summary: "Bevels base crease edges: canonical edge ids, positive mesh-local width, 1–32 segments, profile chamfer/round/circular, trimEndFaces.",
    rules: "trimEndFaces is on unless you set it to false, so the face at each end of a beveled edge (one edge of a box, a seam of a cylinder) is cut back to meet the bevel; turned off, that face keeps its sharp corner and extra faces overlap it. It makes no difference for a closed loop of edges. Disable enabled modifiers first. Boundary and coplanar edges and selections ending partway along a straight edge are unsupported.",
  },
  "geometry.knife_path": {
    summary: "1–64 knife segments applied atomically; each refers to topology after the previous ones. Prefer geometry.bisect for straight cuts.",
    rules: "Predicting the IDs after each segment is error-prone, so prefer geometry.bisect for a straight cut through a region. The whole path is checked once at the end and a failure names the segment. Each segment has the same rules as geometry.knife_chord: face ID and start/end {vertex} or {edge, factor}, planar faces, boundary endpoints.",
  },
  "geometry.knife_chord": {
    summary: "Splits one planar base face between two boundary points: face, start and end as {vertex} or {edge, factor}.",
    rules: "Edge factors run from the lower to the higher numbered vertex and must be strictly within (1e-8, 1-1e-8). The cut cannot follow an existing boundary edge. It splits neighbouring faces to preserve connectivity and corner attributes; nonplanar affected faces and non-affine UV, color or deformation detail are rejected. It does not implement multi-face strokes (use geometry.knife_path). Inspect the base cage and pass expectedRevision.",
  },
  "geometry.correct_normals": {
    summary: "Makes winding consistent per connected shell and rebuilds shading normals: mode consistent (default) or outward.",
    rules: "consistent preserves each shell's first face direction; outward orients closed shells outward independently, including cavity shells, while open shells retain their first face direction. Non-manifold or ambiguous results are rejected; cage reconstruction may omit collapsed triangles.",
  },
  "geometry.remove_duplicate_faces": {
    summary: "Removes identical face loops across the base mesh when winding, material and corner attributes match.",
    rules: "Conflicting overlaps or invalid output are rejected. Cage reconstruction may omit collapsed triangles.",
  },
  "geometry.merge_by_distance": {
    summary: "Merges connected groups among 2–4096 base vertex ids linked within a positive mesh-local distance up to 100; each group moves to its average.",
    rules: "Linked vertices form groups even if a group spans more than the distance.",
  },
  "geometry.merge_vertices": {
    summary: "Collapses 2–4096 unique base vertex ids to mode center (default), first or last in the given order.",
    rules: "Corner attributes interpolate per surviving face. Collapsed faces are removed only when the surface stays valid.",
  },
  "geometry.dissolve_edges": {
    summary: "Removes selected internal coplanar base edges, merging their faces.",
    rules: "Select all internal edges of each region. It refuses material/UV seams, holes, pinched boundaries and non-affine attributes that would be lost.",
  },
  "geometry.slide_edges": {
    summary: "Slides selected edge endpoints along rails [{vertex, toward}], one per unique selected vertex, factor strictly between 0 and 1.",
    rules: "Each toward must be an unselected vertex connected by an existing edge; choose the other neighbouring rail to slide the opposite way. Coordinates are mesh-local. Connectivity and vertex/corner attributes stay attached to their original IDs; this is geometric sliding without UV correction. IDs do not change, so it can share a component-edit batch.",
  },
  "geometry.loop_cut": {
    summary: "Cuts a loop through a quad strip from one canonical base edge: cuts 1–16 (default 1), factor strictly between 0 and 1 (default 0.5).",
    rules: "The offset factor applies only to a single cut and runs from the seed edge's lower-numbered vertex. It follows opposite edges through a quad strip, stopping at open boundaries, and rejects nonquad interruptions or crossing/inconsistent rings.",
  },
  "geometry.bisect": {
    summary: "Cuts a base mesh part with a flat plane: the easiest accurate cut, no edge IDs or factors. plane {axis, offset} or {point, normal}; keep, fill, ids, snapDistance.",
    rules: "plane is {axis:\"x\"|\"y\"|\"z\", offset} (the plane axis = offset) or {point:[x,y,z], normal:[x,y,z]}; space is local (default, the mesh-local coordinates editor.inspect_mesh reports) or world. Every polygon the plane crosses is split and each crossed edge gets one shared new vertex, so the mesh stays watertight; concave polygons and planes through existing vertices, edges or faces are handled exactly. keep is both (default, only cuts), positive (the side the normal points to) or negative, and removes the other side; fill (needs keep) caps the opening with flat polygons so a solid stays closed; a cap can be cut again, so two filled cuts (each its own proposal, inspecting between them) cut a block into a quarter. ids limits the cut to those base faces (not with keep). snapDistance (mesh-local) treats near-plane vertices as on the plane. A plane that misses the mesh is refused with the distance range of the mesh from the plane. Cut faces must be planar with affine UV/color/deformation; triangulate a bent face first. Face IDs shift up after a cut (pieces are consecutive) and new vertices are last; inspect again.",
  },
  "geometry.delete_components": {
    summary: "Deletes base faces, edges or vertices (kind, ids); an edge or vertex takes every face that touches it.",
    rules: "It drops vertices no face uses, keeps the order of what remains, may open a closed mesh, and refuses to remove everything (use scene.delete_object) or to leave faces touching only at a vertex. Follow it with geometry.fill_hole to close the gap.",
  },
  "geometry.bridge_edge_loops": {
    summary: "Joins two closed openings with quads: ids are every edge of both boundary loops; optional twist.",
    rules: "ids are the canonical edge IDs of every edge of both boundary loops (each edge has one face). The loops need at least three edges each and no shared vertex; unequal counts are fine (quads where both loops advance, triangles spread evenly for the extra edges). twist (whole edges, default 0) turns the automatic pairing if the connecting edges cross. Existing IDs stay and new faces are last, so it can share a component-edit batch. Loops already joined by faces are refused.",
  },
  "geometry.separate_faces": {
    summary: "Moves base faces ids into a new sibling object newObjectId (fresh id, optional name); the source keeps the other faces.",
    rules: "The new object has the source's parent, collection and transform and its own copy of every material slot. It refuses all faces, faces that touch only at a corner, skinned meshes, a non-empty meshPath and a mesh with modifiers (clear them first). Send it alone with expectedRevision from a base inspection and inspect the source again afterward.",
  },
  "geometry.set_shading": {
    summary: "Shades a base mesh part flat or smooth, with an optional angle (smooth only) that keeps edges bent more than it crisp.",
    rules: "A cylinder smoothed by angle is round around its side and crisp at its caps. Shape and IDs are unchanged and later base edits keep the choice, so set it once, in any order; it can share a component-edit batch.",
  },
  "geometry.flip_normals": {
    summary: "Reverses whole connected surfaces: omit ids for all, or list base faces and each surface containing one flips.",
    rules: "IDs are unchanged, so it can share a component-edit batch.",
  },
  "geometry.triangulate_faces": {
    summary: "Splits polygons into triangles in place (omit ids for all); keeps materials and attributes.",
    rules: "Triangulate a bent face before cutting it with geometry.bisect.",
  },
};

const OWN_TYPES: ReadonlySet<string> = new Set(Object.keys(COMMAND_REFERENCE));

/** Whether `type` names a command. Only the reference's own keys count, never inherited names such as "constructor". */
export function isCommandType(type: string): type is EditorCommandType {
  return OWN_TYPES.has(type);
}

/** The types in the order the reference lists them. */
export const COMMAND_TYPES: readonly EditorCommandType[] = Object.keys(COMMAND_REFERENCE).filter(isCommandType);

function listTypes(types: Iterable<string>): string {
  return [...types].join(", ");
}

/**
 * The description of editor.propose_commands: how a batch works, the batching rules (written from the same sets the
 * validator enforces, so they cannot disagree), and one line per command. The full rules of each command are in
 * {@link COMMAND_REFERENCE}, which editor.describe_commands returns on request.
 */
export function proposeCommandsDescription(sets: {
  readonly cageEdits: ReadonlySet<string>;
  readonly topologyEdits: ReadonlySet<string>;
  readonly modifiers: ReadonlySet<string>;
}): string {
  const reorderingFree = [...sets.cageEdits].filter((type) => !sets.topologyEdits.has(type));
  return [
    "Submit a batch of 1–200 structured scene commands. Set apply true to validate and apply it in this one call, the usual way to make a change; the result has the applied revision and each command's result. Leave apply out only to look at the proposal first with viewport.capture proposalId, then call editor.apply_proposal. Nothing changes until a proposal is applied; there is no user approval prompt.",
    "Give commands, or the planId that editor.plan_placement, editor.plan_duplicates or modeling.generate_commands returned (it carries their sourceRevision as expectedRevision), so planned commands and their generated ids are never copied by hand.",
    "Commands run in order and later ones may use objects created earlier in the batch. Each commandId is unique in the batch. Change existing objects (rename, visibility, parent, move) instead of recreating them. Scale is positive on every axis. A name a sibling already has gets a number such as .001; read the name each object received from the apply result.",
    `Batching. Component edits (${listTypes(reorderingFree)}) go in batches of their own, at most 20. Edits that renumber vertices, edges or faces (${listTypes(sets.topologyEdits)}) go alone, one per proposal, with enabled modifiers disabled and any live extrusion removed; inspect again before the next edit. Modifier commands (${listTypes(sets.modifiers)}) go in batches of their own, at most 20; create and place objects, cutters included, in an earlier proposal. material.set_properties, material.add_slot and material.replace_slot go in a batch of their own, at most 20; assign faces with material.assign in a later proposal. scene.duplicate_hierarchy goes alone.`,
    "Revisions. A batch with expectedRevision, or with any component edit, modifier, material or duplication command, is strict: it applies only at the revision it was checked at and fails instead of rebasing when the scene changed; read again and propose again. Component edits, material property/slot commands, scene.duplicate_hierarchy and a live extrusion in geometry.set_modifiers also require expectedRevision: the revision of the read that gave their IDs (editor.inspect_mesh with view base, editor.inspect_materials, editor.get_context). Use base IDs, never the IDs of the displayed (evaluated) mesh. Other batches are checked again and rebased (rebased true) when every command still fits.",
    "A refused proposal lists each problem by commandId or field path; fix those commands and propose again. supersedes replaces a proposal of this run that is still waiting. stepId names the step of the latest plan this batch carries out.",
    "Commands, one line each. Before using a geometry or material command for the first time in a run, call editor.describe_commands with its type for its full rules and limits:",
    ...COMMAND_TYPES.map((type) => `- ${type}: ${COMMAND_REFERENCE[type].summary}`),
  ].join("\n");
}
