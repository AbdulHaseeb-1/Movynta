---
name: character-modeling
version: 1.2.0
description: Builds and refines 3D characters, using a blockout only as the starting point for detailed or realistic requests.
dimensions:
  - 3d
tags:
  - character
  - humanoid
  - body
  - model
when_to_use:
  - The user asks for a new 3D character, figure, or humanoid body.
  - The user asks to block out or refine character proportions and appearance.
required_inputs:
  - Character goal and style, inferred from the request when possible.
  - Use sensible scene units and proportions when the user did not specify them; ask only if a missing decision blocks the work.
tools:
  - editor.get_context
  - editor.inspect_mesh
  - editor.inspect_materials
  - modeling.generate_model_plan
  - modeling.generate_commands
  - modeling.propose_generated
  - editor.propose_commands
  - editor.apply_proposal
  - viewport.capture
  - modeling.assess_quality
  - validation.check_scene
validation:
  - Every object has a unique id and finite transform; the hierarchy is valid and groups have uniform scale.
  - validation.check_scene has no error-severity issues after the last change.
  - A structural check is not evidence that the character looks realistic.
  - For explicit realism, detail or refinement requests, review fresh live images from at least two distinct viewpoints and report concrete findings with modeling.assess_quality.
error_handling:
  - If the editor is not connected, report that the editor must be open.
  - On a revision conflict, inspect the latest context and make a new proposal.
  - If images or required modeling capabilities are unavailable, record a blocked quality assessment and explain what remains unverified or unfinished.
  - Never delete existing objects to make room for new ones unless the user asked for it.
---

# Character modeling workflow

## Establish the goal and plan

Read `editor.get_context`. Identify the requested style, subject, view and any accessible reference. Do not claim to have seen a reference that is not actually available. If the user did not give height or proportions, choose reasonable scene-unit assumptions rather than stopping. Ask one focused question only when an essential design decision prevents progress.

Use `modeling.generate_model_plan` with steps appropriate to the requested result. For a realistic or detailed character, include: a proportion blockout; silhouette and anatomy; characteristic head, face, hands, feet and clothing as applicable; surface and material refinement; and visual review with targeted corrections. For a user who explicitly requests only a blockout, stop at the requested stage and describe it as such.

## Build in stages

Create a named, uniformly scaled group for the figure. Place and name subparts under their logical parents. Primitives can establish the initial proportions, but a collection of unrefined spheres and cylinders is a blockout, not a realistic finished character. Use supported mesh creation, editing, modifiers, material properties and procedural generation when they improve the silhouette and distinctive structure. Inspect existing mesh topology and material slots before editing; preserve existing unrelated work. Use world bounds and measurements for placement, and do not equate their validity with visual quality.

Propose small coherent batches with `editor.propose_commands` or use the supported generated-proposal workflow. Inspect geometry candidates with `viewport.capture`, apply through `editor.apply_proposal`, and check the apply result. Use the exact revisions and identifiers returned by tools. Run `validation.check_scene` after changes and fix errors. Keep each stage undoable and avoid unnecessary replacement of existing objects.

## Review and improve

For realism, high detail or an explicit refinement request, capture fresh **live** solid views after applying a stage. Use front, side and three-quarter/isometric views where useful; use close-ups for the face, hands or other important features. Compare with an accessible reference when one exists; otherwise judge against the requested style and your stated assumptions. Check silhouette, proportions, anatomy, characteristic features, obvious intersections, construction quality and appearance as appropriate to the subject.

Call `modeling.assess_quality` with concrete observations. Mark `needs_refinement` when visible defects materially prevent the requested result; fix the highest-impact findings, recapture the changed scene, and assess again. Mark `ready` only when your review finds no major unresolved defects. The assessment is your own fallible judgment, not an independent guarantee. If you cannot see images or cannot reasonably complete a feature with the available tools, mark `blocked` and describe that limitation. Do not invent visual observations.

Continue within the run's existing limits; do not repeat edits without meaningful progress. When finishing, describe the achieved stage and any important remaining shortcomings. Do not describe a primitive blockout as realistic. UV authoring, texture creation and node shaders are not currently available, so do not promise them.

Keep the character centred where appropriate and use scene units unless the project is calibrated. Grouping and collections help organize a figure; they do not themselves add geometric detail.
