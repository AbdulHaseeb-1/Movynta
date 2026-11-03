---
name: mesh-editing
version: 1.2.0
description: Inspects mesh geometry and edits transforms, bevels, subdivision surfaces, replacements, and cleanup through approved commands.
dimensions:
  - 2d
  - 2.5d
  - 3d
tags:
  - mesh
  - edit
  - transform
  - topology
  - bevel
  - subdivision
when_to_use:
  - The user asks to move, scale, rotate, replace, or clean up existing geometry.
  - The user asks to change the topology of an object that already exists.
required_inputs:
  - The objects to change, identified from the editor context.
  - The intended change (for example: scale by 1.2, replace with a sphere).
tools:
  - editor.get_context
  - editor.inspect_mesh
  - modeling.generate_commands
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
  - Report revision conflicts, read the current context, and recalculate before proposing corrected commands.
---

# Mesh editing workflow

1. Call `editor.get_context` and confirm every target object exists.
2. Describe the change in plain language, then build the smallest set of commands that achieves it.
3. Use `scene.transform_object` for position, rotation, and scale changes. Use `geometry.create_primitive` with `replaceExisting` only when the user asked to replace geometry.
4. Submit with `editor.propose_commands` and apply with `editor.apply_proposal`.
5. Validate with `validation.check_scene` and summarise what changed.

For repeated layouts or mathematical placement, calculate command arrays with `modeling.generate_commands` using synchronous JavaScript and the supplied `scene` snapshot. Submit the returned commands with `expectedRevision` equal to `sourceRevision`. If the scene changes, recalculate before proposing again. Programs support the existing commands, including bevel/subdivision; arbitrary mesh creation and material operations remain unavailable.

For surface editing, first call `editor.inspect_mesh` with objectId. Imported groups return parts; choose a meshPath and inspect that mesh. Use offset/limit for local-space vertex, edge and polygon samples; indices refer to the complete topology, not just the sample. Inspect bounds, counts and boundary/winding defects before choosing an operation.

Use `geometry.bevel` with a small positive local-space width and 1–8 segments (default 1; 3–4 gives rounded edges). Use `geometry.subdivide` with 1–3 Catmull–Clark levels. These append live modifiers. Inspect the mesh's `modifiers`, then use `geometry.set_modifiers` with the full ordered list to edit parameters, reorder, disable (`enabled: false`) or remove entries. Each entry has a unique id and kind (`bevel` or `subdivision`); preserve existing ids. Up to eight entries are supported, and an empty list restores the original base mesh.

Concave and open manifold meshes are supported; open boundaries remain open. UV seams, material assignments, vertex colors, skin weights and morph targets are preserved/interpolated. New bevel strips and corner patches use adjacent materials and interpolated UVs; they do not create an automatic texture unwrap. Both geometric and stack edits require approval, use strict scene revisions, and must be submitted separately from creation/transforms (at most 20 commands). Reduce overlapping widths and excessive refinement or explain unsupported topology rather than replacing the model. Users can edit the active mesh part in the manual Modifiers panel; a crease editor is not implemented.
