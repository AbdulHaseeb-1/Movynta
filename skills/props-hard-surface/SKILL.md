---
name: props-hard-surface
version: 1.1.1
description: Builds hard-surface props, furniture, products, vehicles and machines from blockout to detail with consistent bevels, booleans, insets, mirror and array modifiers in the right stack order.
dimensions:
  - 3d
tags:
  - hard surface
  - hard-surface
  - prop
  - props
  - furniture
  - chair
  - table
  - product
  - device
  - gadget
  - machine
  - mechanical
  - robot
  - vehicle
  - car
  - weapon
  - sword
  - panel
  - bolt
when_to_use:
  - The user asks for a manufactured object (a prop, furniture, a product, a device, a vehicle, a weapon, a machine or a building part).
  - The user asks for panels, cut-outs, vents, bolts, chamfers, rounded edges or other hard-surface detail.
required_inputs:
  - The object and its real-world size, or a size relative to something in the scene.
  - The style (realistic, stylized, low-poly) and how close it will be seen.
tools:
  - editor.get_context
  - editor.inspect_mesh
  - editor.measure
  - editor.plan_placement
  - editor.plan_duplicates
  - viewport.capture
  - modeling.record_brief
  - modeling.generate_model_plan
  - modeling.generate_commands
  - editor.propose_commands
  - editor.apply_proposal
  - validation.check_scene
  - validation.check_brief
validation:
  - The model has one group with role-named parts, and its base sits on y = 0 unless the brief says otherwise; modeling.record_brief holds this as a position check, and validation.check_brief passes.
  - Bevel widths come from one size scale (small, medium, large) tied to the model size, not chosen per part at random.
  - Modifier stacks are ordered mirror or array first, then boolean, then bevel, then subdivision.
  - Every boolean cutter is a closed solid, named Cutter.<Purpose>, hidden after the cut is checked, and kept in the scene.
  - validation.check_scene reports no error-severity issues, and a normals capture shows no flipped or shading-broken faces.
error_handling:
  - If a boolean is rejected for an open or invalid operand, close the cutter (use a primitive instead of a sheet) and try once more; otherwise model the recess with inset and extrude.
  - If a bevel overlaps itself on thin parts, reduce the width below half the thinnest wall and retry rather than replacing the part.
  - If a topology edit is refused because modifiers are enabled, disable them with geometry.set_modifiers, make the edit alone, then restore the same stack.
---

# Hard-surface and prop workflow

Load `model-design-principles` for the brief and critique loop if it was selected too. This skill turns that brief into clean manufactured shapes.

## Core ideas

- **Build in passes.** Primary blockout (big volumes, exact sizes), secondary construction (panels, legs, handles, recesses), tertiary detail (bevels, seams, fasteners, vents). Check each pass with captures before the next.
- **Think like a manufacturer.** Decide how each part is made and joined: cast, machined, bent sheet, moulded plastic, welded tube, carved wood. That decides edge radii, wall thickness and where seams go. Moulded plastic has soft, even radii; machined metal has small crisp chamfers; sheet metal has constant thickness and bend radii; wood has eased edges and grain-aligned parts.
- **No perfectly sharp edges.** Real edges catch light because they are bevelled. A small bevel on every hard edge is the single biggest realism gain.
- **Separate parts are fine.** A drawer, a leg or a bolt can be its own object under the group. Intersecting simple parts is often cleaner than one complex mesh, and it keeps topology simple.
- **Symmetry is a modifier.** Model half (or a quarter) and add a `mirror` entry. Model one slat, bolt or rib and repeat it with an `array` entry or `editor.plan_duplicates`.

## Size scale for bevels and details

Pick three sizes from the model's overall size `S` (its largest dimension from `editor.measure`) and reuse them everywhere:

| Level | Typical width | Use |
| --- | --- | --- |
| Large | 2–4% of S | Main outer edges of moulded or stylized parts |
| Medium | 0.8–1.5% of S | Panels, frames, handles |
| Small | 0.2–0.5% of S | Crisp machined edges, seams, bolts |

Never let a bevel be wider than about 40% of the thinnest wall it touches. Stylized and toy-like work uses the large end with `round` or `circular` profiles and 3–4 segments; realistic machined metal uses the small end with 1–2 segments or `chamfer`. Use the bevel `angle` (for example 30°) so only real creases bevel.

Bevel widths are mesh-local. If a part is scaled by its transform, divide the world-space width by that scale, or better, create the part at its real size with primitive `options` and keep the transform scale at 1.

## Modifier stack order

1. `mirror` (and `array`) — build the whole shape from one side or one instance.
2. `boolean` — cut holes, recesses and slots into the full shape.
3. `bevel` — round every edge, including the new cut edges.
4. `subdivision` — only for smooth, moulded or organic-looking parts; give it support from the bevel (2–3 segments) so corners stay tight.

Set the full stack at once with `geometry.set_modifiers` when you know it; preserve entries the user made.

## Step-by-step

1. `editor.get_context`; note the revision and anything to scale against.
2. `modeling.generate_model_plan` with steps for blockout, each secondary feature group, details, and materials.
3. **Blockout.** Create the group with `scene.create_object`, then each main volume with `geometry.create_primitive` at exact `options` sizes, `parentId` on the group and role names (`Body`, `Lid`, `Leg.FL`). Use `editor.plan_placement` to align, gap or distribute parts instead of guessing positions. Use `editor.plan_duplicates` for legs, wheels and repeated parts. Apply, then capture `front`, `right`, `top` and `isometric` and fix proportions first.
4. **Secondary forms.**
   - Recesses and panel insets: `editor.inspect_mesh` with a `faceQuery` for the face normal you want, then `geometry.inset_faces` with a `thickness` and a small negative `depth` (a panel) or positive `depth` (a raised pad).
   - Extensions: `geometry.extrude` with `normalDistance` on queried faces; use `capScale` below 1 for tapered shapes and `steps` for stepped profiles.
   - Holes and slots: create a closed cutter primitive named `Cutter.<Purpose>` under the part, position it so it passes fully through (no coplanar faces with the target), then `geometry.boolean` (`difference`). Hide the cutter with `scene.set_visibility` once the result looks right.
   - Repeated cut-outs (vents, grilles): one cutter plus an `array` entry on the cutter, or `modeling.generate_commands` to lay out many exact positions.
5. **Bevels.** Add `geometry.bevel` after any boolean, with the size from the table. For selected edges only on the base cage, use `geometry.bevel_edges` alone in its own proposal, with `trimEndFaces` true unless the edges form a closed loop.
6. **Tertiary detail.** Fasteners (small cylinders or low-detail spheres), seams (thin insets), feet and pads, labels as shallow insets. Cluster them at the focal point and at joints where they make construction believable. Keep repetitions on an exact grid.
7. **Check.** Before applying a geometric proposal, `viewport.capture` with its `proposalId`. After applying, capture in `normals` mode to catch flipped or faceted faces and in `wireframe` to check density. `editor.measure` (`clearance` or `distance`) checks gaps between moving parts and that parts touch where they should.
8. **Materials.** Follow `pbr-materials-and-color`: separate material slots for distinct materials (painted metal, rubber, glass, bare metal), not colour variations on one slot.
9. `validation.check_scene`, then report the parts, the bevel scale used, and remaining options.

## Common recipes

- **Table**: top box (thickness 3–5 cm), four legs via `editor.plan_duplicates` or mirror on X and Z, an apron frame 8–10 cm tall set back 2–5 cm from the edge, medium bevel on the top, small on the legs.
- **Chair**: seat at 0.45, seat thickness 3–5 cm, legs slightly splayed or tapered (`capScale` on a cylinder or extrude), backrest tilted back 5–15°, mirror on X.
- **Device or gadget**: rounded box body (large bevel, 3 segments), screen or panel as an inset with small negative depth, buttons as short cylinders with circular bevels, seams as thin insets around the parting line.
- **Crate**: box body, frame boards as separate thin boxes slightly proud of the faces, corner brackets, small bevels everywhere.
- **Vehicle**: block the body as 2–3 boxes (hood, cabin, trunk) on top of the wheelbase; wheels as cylinders with radial segments ≥ 24 and wheel arches cut by cylinder cutters slightly larger than the wheels.
- **Sword or tool**: blade as a flattened box tapered with `capScale` and an edge chamfer; guard, grip and pommel as separate parts on one axis; grip about 1.5 hands long.
