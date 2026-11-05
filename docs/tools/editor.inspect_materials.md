# `editor.inspect_materials`

Reads the material slots of one object: name, shader, colour, roughness, metalness, opacity, sidedness and attached texture channels. It reads materials alone, so it works on dense or skinned imports where full topology is too large.

| | |
| --- | --- |
| Provider name | `editor__inspect_materials` |
| Permission | `read` (never needs approval). Nothing changes. |
| Needs the editor | Yes |
| Defined in | `apps/backend/src/modules/tools/editor/editor.tools.ts` |
| Schema | `materialInspectionRequestSchema` in `packages/editor-protocol/src/mesh.schema.ts` |
| Demo | [Read tab](demos/index.html#read) |

## When the assistant uses it

Before any material proposal. Slot indices and the `revision` it returns are what `material.set_properties`, `material.add_slot` and `material.assign` must use.

## Input

| Field | Type | Required | Default | Meaning |
| --- | --- | --- | --- | --- |
| `objectId` | identifier | yes | | The object whose materials to read. |
| `meshPath` | mesh path | no | `[]` | A mesh inside the object. |
| `offset` | integer ≥ 0 | no | `0` | First slot to return. |
| `limit` | integer 1–100 | no | `25` | Slots per page. |

## Result

| Field | Meaning |
| --- | --- |
| `revision` | The scene revision. Use it as `expectedRevision` for material commands. |
| `status` | `ok`, `unsupported` or `not_found`. |
| `materialSlotCount` | Slots on this mesh, across all pages. |
| `materials` | One entry per slot on this page (see below). |
| `parts` | When the object is a group, the mesh paths available inside it. |
| `message` | Why a read is unsupported, when it is. |

Each slot:

| Field | Meaning |
| --- | --- |
| `slot` | Zero-based slot index. |
| `name`, `type` | The material's name and shader type, such as `MeshStandardMaterial`. |
| `editable` | `true` for Standard and Physical materials. Other shaders need `material.replace_slot`. |
| `color`, `emissive` | sRGB `#RRGGBB`, or `null`. |
| `roughness`, `metalness`, `opacity` | Numbers from 0 to 1. |
| `transparent`, `depthWrite`, `side`, `emissiveIntensity` | Rendering settings. |
| `textures` | The texture channels attached, such as `map` or `normalMap`. Image data is not exposed. |

## Example

Request:

```json
{ "objectId": "crate", "meshPath": [], "offset": 0, "limit": 25 }
```

Result:

```json
{
  "revision": 12,
  "status": "ok",
  "materialSlotCount": 1,
  "parts": [],
  "message": null,
  "materials": [
    { "slot": 0, "name": "Crate wood", "type": "MeshStandardMaterial", "editable": true, "color": "#B08A5A", "roughness": 0.8, "metalness": 0, "opacity": 1, "transparent": false, "depthWrite": true, "emissive": "#000000", "emissiveIntensity": 0, "side": "front", "textures": ["map"] }
  ]
}
```

## Visual example

```text
slot 0   Crate wood   #B08A5A   MeshStandardMaterial   editable
         roughness  ████████░░  0.8
         metalness  ░░░░░░░░░░  0.0
         opacity    ██████████  1.0
         textures   map
```

## How it fits

The tool asks the editor for materials only (`materialsOnly`), so it never parses triangles. That keeps the call quick on large imports. The slot numbers it returns are the ones material commands use.

## Limits and errors

- `materialSlotCount` is the total number of slots. Page through the rest with `offset` and `limit` (1–100).
- Non-editable shaders are reported with `editable: false`. Replacing one discards its maps and settings, so the assistant should not do it just to change a colour.
- The tool reports texture channel names only. Creating or importing textures is not available.

## Related

- [`editor.inspect_mesh`](editor.inspect_mesh.md) for geometry.
- [`editor.propose_commands`](editor.propose_commands.md), which carries the material commands (`material.set_properties`, `material.add_slot`, `material.assign`).
