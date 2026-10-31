---
name: mesh-editing
version: 1.0.0
description: Edits existing meshes safely, such as transforms, replacements, and cleanup, with previews and approval for destructive changes.
dimensions:
  - 2d
  - 2.5d
  - 3d
tags:
  - mesh
  - edit
  - transform
  - topology
when_to_use:
  - The user asks to move, scale, rotate, replace, or clean up existing geometry.
  - The user asks to change the topology of an object that already exists.
required_inputs:
  - The objects to change, identified from the editor context.
  - The intended change (for example: scale by 1.2, replace with a sphere).
tools:
  - editor.get_context
  - editor.propose_commands
  - editor.apply_proposal
  - validation.check_scene
validation:
  - Each target object id exists in the latest editor context.
  - Transforms use finite numbers, and scale values are positive.
  - Replacing geometry is an explicit destructive command and is shown for approval.
error_handling:
  - If a target object is missing, stop and ask the user which object to change.
  - If the user rejects a destructive proposal, do not retry it. Propose a non-destructive alternative instead.
  - Report revision conflicts and ask the user to confirm before re-proposing.
---

# Mesh editing workflow

1. Call `editor.get_context` and confirm every target object exists.
2. Describe the change in plain language, then build the smallest set of commands that achieves it.
3. Use `scene.transform_object` for position, rotation, and scale changes. Use `geometry.create_primitive` with `replaceExisting` only when the user asked to replace geometry.
4. Submit with `editor.propose_commands` and apply with `editor.apply_proposal`.
5. Validate with `validation.check_scene` and summarise what changed.

Prefer transforms over replacement. Replacement and deletion are destructive, so they require approval.
