---
name: pbr-materials-and-color
version: 1.0.0
description: Designs believable PBR materials and readable colour palettes (value structure, 60-30-10, hue harmony, physically plausible albedo, metalness and roughness) and applies them through material slots.
dimensions:
  - 2.5d
  - 3d
tags:
  - material
  - materials
  - color
  - colors
  - colour
  - colours
  - palette
  - paint
  - painted
  - pbr
  - shader
  - metal
  - metallic
  - plastic
  - wood
  - glass
  - rubber
  - stone
  - fabric
  - roughness
  - glossy
  - shiny
  - matte
when_to_use:
  - The user asks to colour, paint or texture a model, or to choose a palette or materials.
  - The user asks for a specific material look (metal, plastic, wood, glass, rubber, stone, fabric).
  - A model looks flat, plastic or unreadable because its colours or materials are poorly chosen.
required_inputs:
  - The objects or mesh parts to change, from the editor context.
  - The intended look (realistic or stylized, mood, any brand or reference colours).
tools:
  - editor.get_context
  - editor.inspect_materials
  - editor.inspect_mesh
  - viewport.capture
  - editor.propose_commands
  - editor.apply_proposal
  - validation.check_scene
validation:
  - Materials are inspected with editor.inspect_materials before any change, and edits use its revision.
  - Non-metal base colours stay within about sRGB 30 to 240 in value; metals use metalness 1 with bright base colours.
  - Metalness is 0 or 1 except for deliberate dirty or coated metal.
  - Distinct real materials use distinct slots; existing imported maps and shaders are kept unless the user asked to replace them.
  - A solid capture after applying shows the intended light, mid and dark value structure.
error_handling:
  - If a slot is not editable (an unsupported shader), report it and offer material.replace_slot only if the user wants a new Standard material there.
  - If faces for a new slot cannot be found by a face query, assign the slot to the whole part and say so, or ask the user to select the faces in Edit mode.
  - Never replace imported shaders or maps without explicit intent; prefer material.set_properties.
---

# PBR materials and colour

## Value first, then hue

A model reads by its light and dark pattern before its colours. Plan three value groups: **light**, **mid** and **dark**, with the focal point getting the strongest contrast. A quick test: if every part has nearly the same lightness, the model will look flat whatever the hues are.

- **60-30-10**: about 60% of the visible area in a dominant colour, 30% in a secondary colour, 10% in an accent. Put the accent at the focal point.
- **Harmony**: analogous hues (neighbours on the colour wheel) feel calm; complementary accents (opposites) make the focal point pop; a triad suits playful, stylized work. Pick one scheme.
- **Saturation**: keep large areas less saturated and save the most saturated colour for small accents. Fully saturated primaries over big areas look like placeholders.
- **Temperature**: warm colours advance and cool colours recede; use that to push the focal point forward.
- **Limit the palette**: 3–5 colours for a prop; more needs a strong reason.

## Physically plausible PBR

The editor's Standard material uses a metal/roughness model. Colours are sRGB `#RRGGBB`.

- **Base colour of non-metals** stays between about sRGB 30 (very dark, like charcoal) and 240 (very bright, like fresh snow). Pure black `#000000` and pure white `#FFFFFF` look wrong under light.
- **Metals**: metalness 1. Base colour is the metal's reflectance and is bright: roughly sRGB 180–255 (iron and steel about `#C4C7C8`, chrome `#C4C5C5`, aluminium `#F5F6F6`, silver `#FCFAF5`, gold `#FFE29B`, copper `#FAD0C0`). Dark metals look like plastic.
- **Metalness is binary**: 0 for everything non-metal (paint, plastic, wood, rubber, stone, fabric, glass), 1 for bare metal. Use in-between values only for dirty, dusty or coated metal.
- **Roughness carries the story**: polished chrome 0.05–0.15, brushed metal 0.3–0.5, glossy plastic 0.2–0.35, satin paint 0.4–0.55, matte plastic 0.6–0.75, wood 0.5–0.8, rubber 0.8–0.95, stone and concrete 0.75–0.95, fabric 0.85–1. Vary roughness between parts even when the colour is the same: it is what separates a painted panel from a rubber grip.
- **Painted metal is a non-metal**: metalness 0, with the paint colour.
- **Glass and clear plastic**: low roughness (0–0.1), metalness 0, opacity about 0.2–0.4, `side: double` for thin shells; keep `depthWrite` on for simple solids unless sorting looks wrong.
- **Emissive**: only for real light sources (screens, LEDs, lamps). Use the light's colour with emissiveIntensity 1–5; higher values only for a deliberate glow.

## Starting materials (sRGB, roughness, metalness)

| Material | Colour | Roughness | Metalness |
| --- | --- | --- | --- |
| Light oak | `#B88A5A` | 0.65 | 0 |
| Dark walnut | `#5A3B26` | 0.6 | 0 |
| White painted wall | `#E6E4DF` | 0.85 | 0 |
| Matte black plastic | `#2A2A2C` | 0.7 | 0 |
| Glossy red plastic | `#B3262A` | 0.3 | 0 |
| Rubber | `#232323` | 0.9 | 0 |
| Concrete | `#8C8A85` | 0.9 | 0 |
| Brushed steel | `#C4C7C8` | 0.4 | 1 |
| Polished chrome | `#C4C5C5` | 0.08 | 1 |
| Gold | `#FFE29B` | 0.25 | 1 |
| Copper | `#FAD0C0` | 0.35 | 1 |
| Clear glass | `#F2F6F7` | 0.03 | 0, opacity 0.25 |

Adjust these to the style: stylized work often lifts saturation and lightens darks, but keep the same metalness and roughness logic.

## Workflow

1. `editor.get_context`; find the target objects and mesh paths.
2. `editor.inspect_materials` for each target. Note slot count, shader types, editable flags, maps and the revision.
3. Write a short palette plan: the light/mid/dark groups, the 60-30-10 split, and a table of slots with colour, roughness and metalness.
4. For a part with one material, use `material.set_properties` on its slot. Keep imported maps; set only the values you mean to change.
5. For a second material on one mesh (a rubber grip on a metal handle): `material.add_slot` with its properties, then `editor.inspect_mesh` (`view: base`, a `faceQuery` by normal or centre bounds to find the faces), then `material.assign` with those base face ids and the inspection revision. Keep material batches separate from geometry batches and within 20 commands.
6. Apply, then `viewport.capture` in `solid` mode from the front and isometric views with `labels: false`. Check the value structure, the focal accent and that metals read as metal. A zoomed-out capture checks readability.
7. Iterate with small changes (value steps of about 10–15% lightness, roughness steps of 0.1), then `validation.check_scene` and report the palette table.

Texture import, UV authoring and node shaders are not available; achieve variety through slots, roughness contrast and separate parts.
