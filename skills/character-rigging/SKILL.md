---
name: character-rigging
version: 1.0.0
description: Plans a simple skeleton and parent relationships for a character so it can be posed and animated.
dimensions:
  - 3d
tags:
  - rig
  - rigging
  - skeleton
  - bone
when_to_use:
  - The user asks to rig, skin, or prepare a character for animation.
  - The user asks for a skeleton or bones for an existing character.
required_inputs:
  - The character root object and the body-part objects it should follow.
  - The bone layout the user wants (for example: standard humanoid).
tools:
  - editor.get_context
  - modeling.generate_model_plan
  - editor.propose_commands
  - editor.apply_proposal
  - validation.check_scene
validation:
  - Every bone or joint has a parent that exists, except the root.
  - The skeleton does not contain cycles.
  - Modifying an existing rig is destructive and requires approval.
error_handling:
  - If the character has no body-part objects, stop and ask the user to create the character first.
  - If an existing rig would be replaced, explain the change and wait for approval.
---

# Character rigging workflow

1. Call `editor.get_context` and identify the character root and its body parts.
2. Call `modeling.generate_model_plan` with the bone layout: root, spine, head, arms, legs.
3. Create one empty object per bone with `scene.create_object`, set its parent with `parentId`, and place it at its joint position with `scene.transform_object`.
4. Submit with `editor.propose_commands` and apply with `editor.apply_proposal`.
5. Validate the hierarchy with `validation.check_scene` and report the bone count.

Joint positions should match the body parts they represent. Keep bone names consistent so later animation steps can refer to them.
