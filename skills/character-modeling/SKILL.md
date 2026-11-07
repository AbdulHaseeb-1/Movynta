---
name: character-modeling
version: 1.6.0
description: Builds and refines 3D characters with head-unit proportions, landmarks, shape language and joint pivots, using a blockout only as the starting point for detailed or realistic requests.
dimensions:
  - 3d
tags:
  - character
  - humanoid
  - body
  - model
  - anatomy
  - chibi
when_to_use:
  - The user asks for a new 3D character, figure, or humanoid body.
  - The user asks to block out or refine character proportions and appearance.
required_inputs:
  - Character goal and style, inferred from the request when possible.
  - Use sensible scene units and proportions when the user did not specify them; ask only if a missing decision blocks the work.
tools:
  - editor.get_context
  - editor.measure
  - editor.inspect_mesh
  - editor.inspect_materials
  - modeling.record_brief
  - modeling.generate_model_plan
  - modeling.generate_commands
  - modeling.propose_generated
  - editor.propose_commands
  - editor.apply_proposal
  - viewport.capture
  - validation.check_scene
  - validation.check_brief
validation:
  - Every object has a unique id and finite transform; the hierarchy is valid and groups have uniform scale.
  - validation.check_scene has no error-severity issues after the last change.
  - validation.check_brief shows no failing check after the last change: height, feet on the floor, left and right limbs mirrored, hands and head attached.
  - A structural check is not evidence that the character looks realistic.
  - For explicit realism, detail or refinement requests, take fresh live images from at least two distinct viewpoints yourself and fix what they show. An independent reviewer examines the finished result; you do not grade it.
  - The work is done in chunks, one body part or one feature at a time, and each chunk passes its gate (see Chunks and gates) before the next starts.
  - Left and right are built one side at a time: the first side is verified, then the second is made from it and checked as a mirror.
error_handling:
  - If the editor is not connected, report that the editor must be open.
  - On a revision conflict, inspect the latest context and make a new proposal.
  - If images or required modeling capabilities are unavailable, say what remains unverified or unfinished instead of implying the character was checked.
  - Never delete existing objects to make room for new ones unless the user asked for it.
  - If a gate fails, fix that chunk and run its gate again. Do not start the next chunk, and do not hide the problem with later detail.
  - If the same fix fails twice, stop adding to the figure, say what is wrong, and ask or choose a different approach.
---

# Character modeling workflow

## Establish the goal and plan

Read `editor.get_context`. Identify the requested style, subject, view and any accessible reference. Do not claim to have seen a reference that is not actually available. If the user did not give height or proportions, choose reasonable scene-unit assumptions rather than stopping. Ask one focused question only when an essential design decision prevents progress.

Record the measurable parts of the goal with `modeling.record_brief` before building. For a figure of height H: `size` of the figure group on y between 0.95 H and 1.05 H; `position` of its low edge (`anchor: "min"`, axis y) exactly 0; `symmetric` for each left and right pair (`Arm.L` and `Arm.R`, `Leg.L` and `Leg.R`) across x; `contained` for the head inside the figure group; `gap` on y from feet to legs and head to neck between -0.02 and 0.02 so no part floats or sinks. Pick the head-unit proportions from the style table below. Names must match what you create.

Use `modeling.generate_model_plan` with steps appropriate to the requested result. For a realistic or detailed character, include: a proportion blockout; silhouette and anatomy; characteristic head, face, hands, feet and clothing as applicable; surface and material refinement; and visual review with targeted corrections. For a user who explicitly requests only a blockout, stop at the requested stage and describe it as such.

## Chunks and gates

Work strictly in the order below. A chunk is one plan step (give each its own `stepId`). Propose at most 40 commands for it, apply it, then pass its gate before the next chunk. The gate is always `validation.check_scene` with no errors, then the measurement or capture named here. Never build two chunks in one batch, and never start a chunk while the gate before it is failing.

| # | Chunk | Gate before the next one |
| --- | --- | --- |
| 0 | Brief and plan. No scene change. | `modeling.record_brief` and `modeling.generate_model_plan` recorded; style, head units H, total height and every part name decided. |
| 1 | Figure group, pelvis and torso. | Group has scale 1; torso height and width match the landmark table (`editor.measure`); front capture reads as a torso. |
| 2 | Neck and head. | Head height = H, chin at 1 H below the crown; side capture shows the head sits over the neck, not forward of the feet. |
| 3 | One arm, shoulder to hand block, pivot at the shoulder. | Length against the table; pivot at the joint; then make the other arm and check `symmetric` across x. |
| 4 | One leg, hip to foot block, pivot at the hip. | Feet bottom at y = 0 (`gap` check); then the other leg, mirrored. |
| 5 | Hands and feet. | Sizes match the table (hand about 3/4 H, foot about 1 H); capture of each. |
| 6 | Face and characteristic features, one feature per batch. | Close-up capture of the head from front and side after each feature. |
| 7 | Clothing, hair, accessories, one item per chunk. | Each item sits on the body without floating or sinking (`gap` or `clearance`) and has a role name. |
| 8 | Materials, one slot at a time (`pbr-materials-and-color`). | Solid capture shows light, mid and dark groups. |
| 9 | Review: `validation.check_brief` passes, live front, side and three-quarter captures, and you fix what they show. | Every brief check passes on the final scene; remaining shortcomings are listed. |

A request for only a blockout ends after chunk 4 and is described as a blockout. For a realistic or detailed request, do not stop before chunk 7.

## Build in stages

Create a named, uniformly scaled group for the figure. Place and name subparts under their logical parents. Primitives can establish the initial proportions, but a collection of unrefined spheres and cylinders is a blockout, not a realistic finished character. Use supported mesh creation, editing, modifiers, material properties and procedural generation when they improve the silhouette and distinctive structure. Inspect existing mesh topology and material slots before editing; preserve existing unrelated work. Use world bounds and measurements for placement, and do not equate their validity with visual quality.

Propose small coherent batches with `editor.propose_commands` or use the supported generated-proposal workflow. Inspect geometry candidates with `viewport.capture`, apply through `editor.apply_proposal`, and check the apply result. Use the exact revisions and identifiers returned by tools. Run `validation.check_scene` and `validation.check_brief` after changes, fix errors and failing checks, and measure again. Keep each stage undoable and avoid unnecessary replacement of existing objects.

## Review and improve

For realism, high detail or an explicit refinement request, capture fresh **live** solid views after applying a stage. Use front, side and three-quarter/isometric views where useful; use close-ups for the face, hands or other important features. Compare with an accessible reference when one exists; otherwise judge against the requested style and your stated assumptions. Check silhouette, proportions, anatomy, characteristic features, obvious intersections, construction quality and appearance as appropriate to the subject.

Fix the highest-impact defects you see, recapture the changed scene, and look again. You do not decide when the character is good enough: when you finish, an independent reviewer who did not build it examines the scene against the request. If it finds major problems you receive them as findings with a fix for each; carry them out, and the result is reviewed again. If you cannot see images or cannot reasonably complete a feature with the available tools, say so plainly. Do not invent visual observations.

Continue within the run's existing limits; do not repeat edits without meaningful progress. When finishing, describe the achieved stage and any important remaining shortcomings. Do not describe a primitive blockout as realistic. UV authoring, texture creation and node shaders are not currently available, so do not promise them.

Keep the character centred where appropriate and use scene units unless the project is calibrated. Grouping and collections help organize a figure; they do not themselves add geometric detail.

## Proportions by style

Measure in **head units** (H = height of the head, chin to crown). Total height = heads × H.

| Style | Heads tall | Notes |
| --- | --- | --- |
| Chibi / super-deformed | 2–3 | Head about as big as the body; tiny hands and feet; no neck |
| Toy-like / cartoon | 3–5 | Big head and hands, short limbs, simple shapes |
| Stylized hero | 5–7 | Exaggerate one trait (shoulders, hands, head) |
| Realistic adult | 7–7.5 (women about 7–7.5, men 7.5–8) | Average human |
| Idealized / heroic | 8–8.5 | Longer legs, broader shoulders |

Landmarks for a 7.5–8 head adult, measured from the crown down:

- 1 H: chin. 1⅓ H: base of the neck. 2 H: nipple line. 3 H: navel and elbows. 4 H: crotch, which is about half of total height; wrists hang level with it.
- 5½–6 H: knees, about 2 H above the floor. Ankles about ½ H above the floor.
- Shoulder width about 2–2⅓ H for men and 1¾–2 H for women; hips about 1½ H for men and 1¾–2 H for women.
- Upper arm about 1½ H, forearm about 1¼ H, hand about ¾ H (roughly the face from chin to hairline). Thigh about 2 H, shin about 2 H, foot about 1 H long.
- Arms hanging down reach mid-thigh; arm span is about equal to height.

Stylized work keeps the landmark order but stretches or shrinks the parts; chibi figures put the crotch around 1½–2 H from the top and drop the neck.

## Shape and appeal

- Pick a dominant **shape language** for the personality: round for friendly, square for strong and steady, triangular (wide shoulders, narrow waist, pointed shapes) for heroic, fast or villainous.
- Vary sizes: one big mass (torso or head), medium masses (limbs), small details (hands, feet, features). Avoid making every part the same thickness.
- Give limbs a slight taper (wider at the top: cylinder `radiusTop` larger than `radiusBottom`) and avoid perfectly straight, stiff tubes. A light forward tilt of the head and slightly bent arms read more natural than a rigid T-pose; use an A-pose (arms about 30–45° down) when the user does not ask for a pose.
- Keep the centre of mass over the feet so the figure looks like it can stand.

## Joint pivots

Place each limb so its pivot is at the joint: a limb part's local origin sits at the shoulder, hip, elbow or knee, and the geometry hangs from it (offset the mesh half its length along the limb inside a child, or position the part so its top is at the joint). Then rotating `Arm.L` turns it around the shoulder instead of its middle. Mirror left and right parts across x = 0 (`.L` at +x, `.R` at −x) with identical sizes.

## Visual check

After applying the blockout, call `viewport.capture` on the character's group with orthographic `front` and `right` views and `guides: true`. Compare landmarks to the table (crotch near half height, knees near a quarter of height above the floor) and use `editor.measure` for total height. Fix proportions before adding detail, and state what the captures showed in your reply.
