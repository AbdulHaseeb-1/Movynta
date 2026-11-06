---
name: model-design-principles
version: 1.0.0
description: Applies professional 3D design principles (silhouette, proportion, shape language, big-medium-small, real-world scale and an iterative blockout-to-detail review loop) to plan and judge any model.
dimensions:
  - 2d
  - 2.5d
  - 3d
tags:
  - design
  - designer
  - silhouette
  - proportion
  - proportions
  - appealing
  - appeal
  - stylized
  - stylised
  - realistic
  - asset
  - concept
  - blockout
  - critique
  - review
  - improve
  - better
  - professional
  - quality
when_to_use:
  - The user asks for a new model, prop, object, asset or scene and wants it to look well designed.
  - The user asks to review, critique, improve or make a model more appealing, readable or professional.
  - The user asks about proportion, silhouette, style, scale or design quality.
required_inputs:
  - What the object is and what it is for (its function, its user and where it will be seen).
  - The style (realistic, stylized, low-poly, toy-like) and the real-world size, or a size relative to something in the scene.
tools:
  - editor.get_context
  - editor.measure
  - editor.inspect_mesh
  - viewport.capture
  - modeling.generate_model_plan
  - editor.propose_commands
  - editor.apply_proposal
  - validation.check_scene
validation:
  - The plan names a design brief (function, style, size, focal point) before any geometry is proposed.
  - Primary forms are created and checked from front, side and top orthographic views before secondary or tertiary detail is added.
  - Overall size matches the brief or the real-world reference table within about 10 percent, checked with editor.measure.
  - Every part has a role name and sits under one group for the model, so it can be moved and judged as a whole.
  - validation.check_scene reports no error-severity issues after each applied change.
error_handling:
  - If the brief is missing the object's purpose or style, pick a sensible default, state it in the plan, and invite the user to change it rather than stopping.
  - If a capture shows the silhouette does not read, fix the primary forms with a new proposal before adding detail; never hide a weak silhouette with small details.
  - If a size is unknown and not in the reference table, scale from the nearest known neighbour in the scene (a character, a door, a table) and say so.
---

# Model design principles

Use this skill as the design brain on top of the editing skills. It says *what* good looks like and *in what order* to build; `mesh-editing`, `props-hard-surface`, `topology-and-subdivision` and `pbr-materials-and-color` say *how* to do each step with the editor.

## 1. Write a design brief first

Before any command, put a short brief in the plan (`modeling.generate_model_plan` summary or first step):

- **Function**: what it does, who uses it, how it is held, opened, sat on or moved. Form follows function: every part should have a reason to exist (structure, grip, joint, fastening, airflow, decoration with intent).
- **Style**: realistic, stylized, toy-like or low-poly. Style sets how far proportions may be pushed and how big bevels and details are.
- **Size**: a real-world size in scene units (1 unit = 1 metre unless the scene says otherwise). Use the reference table below.
- **Focal point**: the one area the eye should go to first. Detail and contrast concentrate there.
- **Viewing distance**: close-up hero object, mid-ground prop or background filler. Far objects need bolder, simpler shapes and fewer details.

## 2. Build in passes: primary → secondary → tertiary

1. **Primary forms (blockout)**: the 1–5 biggest volumes that make the silhouette. Primitives only, no detail. Get size, proportion and silhouette right here; nothing later can rescue a weak blockout.
2. **Secondary forms**: the medium shapes that explain construction: panels, handles, legs, rims, recesses, cut-outs, joints. Add with extrude, inset, boolean and separate parts.
3. **Tertiary detail**: the small things that sell scale and realism: bevels, seams, bolts, vents, text-size panels, wear. Keep them grouped in clusters near the focal point and leave other areas calm.

Make one plan step per pass (and per major part inside a pass), propose each pass separately, and review after each one. A reviewer can then reject a pass without losing the others.

## 3. Principles to check at every pass

- **Silhouette**: the model should be recognisable as a flat black shape. Check front, side and top orthographic views plus one three-quarter perspective. Look for a clear outline with distinct negative spaces (gaps between legs, under handles, around arms). Avoid silhouettes that are a plain box or blob.
- **Big, medium, small**: give the model one dominant mass, a few medium masses and many small ones. A useful rule of thumb is roughly 60 / 30 / 10 of visual area. Equal-sized parts look monotonous; vary scale by at least 1.5–2× between levels.
- **Rest and detail**: pair busy areas with plain areas. A surface covered evenly with detail reads as noise. Leave calm "resting" planes so the detail clusters read.
- **Shape language**: circles and spheres read friendly, soft and safe; squares and boxes read stable, strong, dependable; triangles and wedges read dynamic, fast, dangerous. Pick a dominant shape for the object's personality and use the others as accents.
- **Straight against curve**: contrast straight lines with curves, and thick parts with thin ones. Sculpted, appealing forms usually have one straight side opposite a curved side, not two symmetric bulges.
- **Proportion and exaggeration**: realistic work stays close to reference ratios. Stylized work pushes the important feature (big head, chunky hands, thick base, tall spire) by 1.5–3× and shrinks unimportant ones. Push deliberately, not uniformly.
- **Rhythm and repetition**: repeated elements (bolts, slats, windows) should share size and spacing; break the rhythm only on purpose, at the focal point. Use `editor.plan_duplicates` or an array modifier so spacing is exact.
- **Avoid tangents**: parts should clearly overlap, clearly separate, or clearly connect. Edges that just touch, or parts that end exactly on another part's silhouette, read as mistakes. Overlap by a visible amount or leave a visible gap.
- **Balance and visual weight**: heavy masses low, the centre of mass over the base, the base wide enough to stand. For a deliberately unstable look, make the imbalance obvious, not accidental.
- **Thickness and believability**: real objects have wall thickness, bevelled edges and supports. Zero-thickness walls, razor-sharp edges and floating parts look CG. Every part should be attached to something with a believable joint.
- **Consistent level of detail**: bevel width, detail size and polygon density should be similar across the model at the same viewing distance. One hyper-detailed part on a crude model looks wrong.
- **Readable at the target distance**: zoom the capture out (`zoom` 0.5 or a far camera). If details vanish into noise, make them bigger and fewer.

## 4. Real-world reference sizes (metres)

Use these for realistic work and as anchors for stylized work. Y is up.

| Object | Typical size |
| --- | --- |
| Adult human | 1.6–1.85 tall; eye height about 1.5–1.65; shoulder width 0.4–0.46 |
| Interior door | 0.8–0.9 wide, 2.0–2.1 tall |
| Dining table | top at 0.72–0.76; 0.8–0.9 deep |
| Desk | top at 0.72–0.75 |
| Chair | seat at 0.43–0.47; seat 0.4–0.45 deep; back to 0.8–1.0 |
| Kitchen counter | top at 0.88–0.92; 0.6 deep |
| Bar counter | top at 1.02–1.07 |
| Coffee table | top at 0.4–0.46 |
| Bed (double) | about 1.4 × 2.0, mattress top at 0.5–0.6 |
| Stair step | riser 0.15–0.19, tread 0.25–0.30 |
| Ceiling | 2.4–3.0 above the floor |
| Car | about 4.5 long, 1.8 wide, 1.45 tall; wheel diameter 0.6–0.7 |
| Mug | about 0.08 wide, 0.095 tall |
| Smartphone | about 0.072 × 0.15 × 0.008 |
| Sword (one-handed) | 0.9–1.0 long; grip 0.1–0.15 |

These vary by country and maker; treat them as starting points.

## 5. Workflow with the editor

1. Call `editor.get_context`. Note the revision, scene units, existing objects and anything to scale against.
2. Write the brief and call `modeling.generate_model_plan` with one step per pass and major part.
3. **Blockout**: create one empty group for the model with `scene.create_object` (named for the object), then primitives under it with role names (`Seat`, `Leg.FL`, `Backrest`). Set exact sizes with primitive `options` rather than scaling a unit cube unevenly. Place the base on y = 0 and centre the model on its group.
4. Apply, then `viewport.capture` with `focus` on the group and views `front`, `right` and `top` (orthographic) plus `isometric`. Set `labels: false` when judging shape. Measure the overall size with `editor.measure` (`dimensions`).
5. Critique against section 3. Write two or three concrete fixes ("the seat is too thin for the leg thickness; double it") and supersede or follow up with a new proposal. Repeat until the silhouette and proportions read.
6. **Secondary pass**: add construction shapes. Use the `props-hard-surface` or `character-modeling` workflow as appropriate. Capture again before applying when the change is geometric (`viewport.capture` with the pending `proposalId`).
7. **Tertiary pass**: bevels, seams and small parts, clustered at the focal point. Check normals and smoothing with `mode: normals`.
8. **Materials**: follow `pbr-materials-and-color` for a value-first palette.
9. Call `validation.check_scene`, then report the brief, what was built, and the open design choices the user may want to change.

## 6. Self-critique checklist (use before reporting)

- Does the silhouette read from the front, side and top?
- Is there one dominant mass, a few medium ones and small details, with clear size steps?
- Is detail concentrated at the focal point, with calm areas elsewhere?
- Are the sizes believable against the reference table or neighbouring objects?
- Is every part attached, with no tangents, floating pieces or zero-thickness walls?
- Are bevels and detail density consistent across the model?
- Does the material palette have a clear value structure (light, mid, dark)?

If any answer is no, fix it before declaring the work finished, or tell the user what is left and why.
