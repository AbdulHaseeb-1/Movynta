---
name: 2.5d-character-design
version: 1.1.0
description: Designs layered 2.5D characters from flat sprite planes arranged in depth, for parallax and side-view animation.
dimensions:
  - 2.5d
tags:
  - 2.5d
  - layer
  - sprite
  - parallax
when_to_use:
  - The user asks for a 2.5D character, a sprite-based character, or a layered character.
  - The user asks for parallax or depth between character parts.
required_inputs:
  - The character style and the number of layers the user wants.
  - The view direction (for example: front, three-quarter, side).
tools:
  - editor.get_context
  - modeling.generate_model_plan
  - editor.propose_commands
  - editor.apply_proposal
  - validation.check_scene
validation:
  - Each layer is a flat plane with a unique object id and a distinct depth (z position).
  - Layers do not share the same depth value.
  - The proposal stays within the layer limit of the plan.
  - Every layer is in one collection, named for the character's layers, and has a role name (Hair, Face, Body).
error_handling:
  - If the requested layer count is very high, propose a smaller set and explain the trade-off.
  - If a layer cannot be placed, report the conflict instead of overlapping layers.
  - If the editor is too old for collections or for name and transform on shapes, create each plane and then use `scene.rename_object` and `scene.transform_object`, and leave the collection out.
---

# 2.5D character design workflow

1. Call `editor.get_context` and note the existing objects.
2. Call `modeling.generate_model_plan` with the dimension `2.5d` and one step per layer, ordered from back to front.
3. Make one collection for the layers with `scene.create_collection` (for example `Layers`, or the character's name followed by `Layers`). For each layer, create a plane with `geometry.create_primitive` (primitive `plane`), `collectionId` set to that collection, a role `name` (`Hair`, `Face`, `Body`), and a `transform` that puts it on its own depth. Step depth is 0.1 scene units. Create them back to front, so the collection lists them in depth order.
4. Submit with `editor.propose_commands` and apply with `editor.apply_proposal`. Read the names back from the apply result.
5. Validate with `validation.check_scene` and report the layer order.

The depth is the plane's z position; the collection only keeps the layers together. To hide or show every layer at once, use `scene.set_collection_visibility`; an individual layer is hidden with `scene.set_visibility`.

Keep layers flat so that they read as sprites. Use depth only to separate parts, not to model volume.
