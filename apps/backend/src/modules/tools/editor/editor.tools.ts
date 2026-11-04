import { z } from "zod";
import { meshInspectionRequestSchema } from "@movynta/editor-protocol";
import type { AgentRunContext } from "../../agent-runs/agent-runs.types.js";
import type { EditorBridge } from "../../editor-bridge/editor-bridge.types.js";
import { editorCommandListSchema } from "../../../shared/schemas/editor-command.schema.js";
import { defineTool, type ToolDefinition } from "../tool.types.js";
import type { EditorToolDependencies } from "./editor.types.js";

const identifier = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const noInput = z.object({}).strict();

/** Every editor tool first confirms the run's editor connection is still live for this user. */
function assertConnection(bridge: EditorBridge, context: AgentRunContext): void {
  bridge.assertConnection(context.userId, context.projectId, context.clientId);
}

export function createEditorTools({ bridge, proposals }: EditorToolDependencies): ToolDefinition[] {
  return [
    defineTool({
      name: "editor.inspect_mesh", permission: "read",
      description: "Inspect mesh topology and local-space vertex/edge/face samples. Supply objectId, optional meshPath (child-index path, [] for the object itself), view ('base' or 'evaluated', default evaluated), offset and limit (1–100, default 25). Base inspects the unmodified cage; evaluated inspects the displayed mesh. To find faces efficiently, use faceQuery.normal (mesh-local direction), minDot (default 0.9), and/or mesh-local centerMin/centerMax. faceMatches returns IDs, total, offset and hasMore; faceQuery.limit is 1–1000, default 100. Set includeSamples false to omit vertex, edge and face pages. Example: faceQuery {normal:[0,1,0], minDot:0.95} finds upward-facing local faces. Use returned IDs only with that view and revision. Imported groups return mesh paths. Evaluated faces may carry baseFaceIndex when their source is known. Source meshes above 20000 triangles may be unsupported. Nothing changes.",
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
        "Submit a batch of structured scene commands for preview. A proposal alone does not request approval or show an approval card. After a successful proposal, call editor.apply_proposal with the returned proposalId even if requiresApproval is true; that call requests approval when needed. Nothing changes until the proposal is approved and applied.",
        "Commands run in order, and later commands may use objects created earlier in the same batch.",
        "Change existing objects with scene.rename_object, scene.set_visibility and scene.set_parent instead of recreating them.",
        "geometry.bevel appends a live bevel with mesh-local width, 1–8 segments, profile chamfer, round (default), or circular, and minimum crease angle 0–180 degrees. Use circular with 3–4 segments for rounded corners. Coplanar edges are skipped. geometry.subdivide appends a live modifier with levels 1–3 and method catmull-clark (default), linear, or loop. geometry.set_modifiers replaces the ordered stack of at most eight entries, with unique ids and enabled flags. Inspect existing entries and preserve their ids and parameters.",
        "geometry.boolean appends a live difference (default), union, or intersect. Supply objectId, optional meshPath, operandObjectId and optional operandMeshPath. Both inputs must be closed solids and the operand must already exist. The operand stays in the scene. Use editor.inspect_mesh stats.materialSlots to validate the zero-based cutMaterialIndex for cutter faces. UVs and vertex colors are interpolated. Create and position the cutter first, then batch geometry.boolean followed by geometry.bevel to round the cut. Modifier batches accept at most 20 commands and use strict revisions and approval.",
        "geometry.extrude rewrites the base cage. Supply kind, ids, and exactly one of nonzero mesh-local offset or signed normalDistance (faces only). normalMode region moves the cap along its average normal, vertex moves the shared cap vertices along their normals, and individual extrudes each face separately. Faces support capScale or capScaleXY, capRotationDegrees in mesh-local XYZ, and twistDegrees about the extrusion axis. steps repeats a face extrusion 1–16 times, applying the same parameters to each new cap. closeOpenSurface closes an entire open planar sheet with a region-normal extrusion. Use verified base IDs and expectedRevision when passing componentView base.",
        "geometry.transform_faces moves shared cage vertices without changing topology. Supply face ids and transform.position (delta), transform.rotation (XYZ radians), or transform.scale (per-axis factors 0.001–100). Scale and rotate around the selected vertices' centroid. space defaults to local and can be world. With enabled modifiers, use verified base IDs, componentView base and expectedRevision. Batch up to 20 component edits with extrusion, hole fill, or selected-face subdivision. These commands require approval.",
        "For adjustable extrusion, use geometry.set_modifiers with a first entry of kind extrusion, id, enabled, ids, baseKey from editor.inspect_mesh with view base, and signed normalDistance (-100 to 100, nonzero). Optional capScale, twistDegrees and closeOpenSurface work like face extrusion. Preserve the remaining modifiers, and pass the base inspection revision as expectedRevision. A stale baseKey is rejected. Hole fill and base edits that preserve the anchored face polygons can retain the modifier. Face transforms and extrusions with explicit base face IDs are validated against those anchors. Other base edits require removing it first.",
        "Face extrusion supports normalMode individual for separate face normals. Adjacent coplanar faces require region mode. Use capScaleXY instead of capScale to scale along two axes perpendicular to the displacement, or capRotationDegrees for mesh-local XYZ rotation before twist. Live extrusion accepts the same shaping options for faces, or use componentKind edge or vertex with offset instead of normalDistance.",
        "geometry.fill_hole closes one simple boundary loop. Nonplanar loops require a simple projection and are triangulated. Supply objectId, optional meshPath and 3–256 canonical boundary edge IDs from editor.inspect_mesh. With modifiers enabled, inspect view base, set componentView to base and pass the inspection revision as expectedRevision. Requires approval and can share a component edit batch.",
        "geometry.subdivide_faces splits the listed base faces into quads and inserts shared edge midpoints into neighboring faces. Disable enabled modifiers first. It requires approval and a strict revision, and can share a batch with other component edits (at most 20 commands).",
        "geometry.create_primitive creates a box, sphere, cylinder, cone, torus, plane, tetrahedron, octahedron or icosahedron. Give a fresh objectId and size. Optional name (the kind of shape when left out), parentId (an existing object, or one created earlier in the batch) and transform (position, rotation, scale local to the parent) create, name, parent and place the shape in one command; they cannot be combined with replaceExisting. A name that a sibling under the same parent already has is made unique with a number such as .001, and editor.apply_proposal returns the name each object received. Optional options specify mesh-local dimensions and density: box width/height/depth, plane width/height, sphere radius/widthSegments/heightSegments, cylinder radiusTop/radiusBottom/height/radialSegments/heightSegments, cone radius/height/radialSegments/heightSegments, torus radius/tube/radialSegments/tubularSegments, and polyhedra radius/detail 0–4. Unspecified fields retain the size-based defaults. Dimensions are positive and at most 100, cylinder radii may be zero individually, segments are bounded and the resulting mesh must fit 20000 triangles. Example: a tapered cylinder uses options {radiusTop:0.5,radiusBottom:1,height:3,radialSegments:32}. Do not call scene.create_object first for the same objectId.",
        "geometry.create_mesh creates a new mesh with a fresh objectId, optional name, optional parentId and transform (local to the parent), vertices as mesh-local [x,y,z] arrays, and faces as arrays of zero-based vertex indices in consistent winding order. shading is flat (default) or smooth. Limits: 3–4096 vertices, 1–4096 faces, 3–64 distinct indices per face, coordinates within ±10000, and at most 20000 triangles. Every vertex must be used; coincident vertices must share an index. The editor rejects degenerate, non-manifold and inconsistent surfaces. Open boundaries are allowed. Use modeling.generate_commands to construct arrays compactly, and preview from multiple views before applying. Self-intersection detection, UV and custom material creation are unavailable.",
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
        const latestPlan = context.plans[context.plans.length - 1];
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
          nextAction: "Call editor.apply_proposal with this proposalId. If approval is required, that call will request it before applying the changes.",
        };
      },
    }),

    defineTool({
      name: "editor.apply_proposal",
      description: [
        "Apply a previously proposed batch in the editor. Destructive or large batches need user approval first.",
        "If the scene changed since the proposal was made, the batch runs again on the new scene when every command still fits;",
        "the result then has rebased true. Otherwise the result is failed and the batch must be proposed again.",
        "Each entry of results may carry name, the name an object received from a command that created, renamed or re-parented it; a name already used by a sibling gets a number.",
      ].join(" "),
      permission: "apply",
      parameters: z.object({ proposalId: identifier }).strict(),
      // An unknown proposal is treated as needing approval, so a person still sees the request.
      requiresApproval: (input, context) => {
        try {
          return proposals.require(context.runId, input.proposalId).requiresApproval;
        } catch {
          return true;
        }
      },
      execute: async (input, context) => {
        assertConnection(bridge, context);
        const result = await proposals.apply(
          { id: context.runId, userId: context.userId, projectId: context.projectId, clientId: context.clientId },
          input.proposalId,
        );
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
