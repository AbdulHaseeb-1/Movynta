---
name: character-modeling
version: 1.0.0
description: Plans and builds 3D character bodies from primitives and simple mesh proportions in the editor.
dimensions:
  - 3d
tags:
  - character
  - humanoid
  - body
  - model
when_to_use:
  - The user asks for a new 3D character, figure, or humanoid body.
  - The user asks to block out proportions before detailing.
required_inputs:
  - Character goal and style (for example: stylized, realistic, chibi).
  - Target height in scene units, and the number of body parts to block out.
tools:
  - editor.get_context
  - modeling.generate_model_plan
  - editor.propose_commands
  - editor.apply_proposal
  - validation.check_scene
validation:
  - Every object has a unique id and a finite transform before a proposal is created.
  - The proposal references only objects present in the latest editor context.
  - validation.check_scene reports no error-severity issues after the change is applied.
error_handling:
  - If the editor is not connected, stop and report that the editor must be open.
  - If a proposal is rejected or fails with a revision conflict, read the context again and build a new proposal.
  - Never delete existing objects to make room for new ones unless the user asked for it.
---

# Character modeling workflow

1. Call `editor.get_context` and note the existing objects and the revision.
2. Call `modeling.generate_model_plan` with the goal, the dimension `3d`, and the ordered body-part steps (torso, head, arms, legs). Keep each step small.
3. For each step, add a `geometry.create_primitive` command. It creates the object itself, so its `objectId` must be new: do not call `scene.create_object` with the same id first. Use `scene.create_object` only for empty groups, and use `scene.transform_object` to position parts. Use the step ids as the basis of object ids.
4. Submit everything with `editor.propose_commands`. Keep proposals under 20 commands so they are easy to review.
5. Call `editor.apply_proposal` with the returned proposal id. The user may need to approve it first.
6. Call `validation.check_scene`. Fix any error-severity issues with a new proposal.
7. Report the created objects and anything the user should review.

Use scene units, keep the character centred on the origin, and place feet on the ground plane (y = 0).
