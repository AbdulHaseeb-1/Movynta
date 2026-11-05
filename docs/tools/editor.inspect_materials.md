# `editor.inspect_materials`

> Reads the material slots of one object: name, shader, colour, roughness, metalness, opacity, sidedness and texture channels, without reading topology.

| | |
| --- | --- |
| Provider name | `editor__inspect_materials` |
| Type | Read (permission `read`) |
| Approval | Never |
| Needs the editor | Yes |
| Example | Live editor output; the test checks its shape |
| Defined in | `apps/backend/src/modules/tools/editor/editor.tools.ts` |
| In the app | Documentation → Assistant tools → Read |

## When the assistant uses it

- Before any material proposal. The slot indices and revision it returns are what material commands use.

## Input

| Name | Type | Required | Default | Meaning |
| --- | --- | --- | --- | --- |
| `objectId` | identifier | Yes | – | The object whose materials to read. |
| `meshPath` | mesh path | No | `[]` | A mesh inside the object. |
| `offset` | integer ≥ 0 | No | `0` | First slot to return. |
| `limit` | integer 1–100 | No | `25` | Slots per page. |

## Result

| Field | Meaning |
| --- | --- |
| `revision` | Use as expectedRevision for material commands. |
| `status, message` | ok, unsupported or not_found, and the reason. |
| `materialSlotCount` | Total slots on this mesh, across all pages. |
| `materials[]` | slot, name, type, editable, color, emissive, roughness, metalness, opacity, transparent, depthWrite, side, textures. |
| `parts` | For a group, the mesh paths available inside it. |

## Example

Request:

```json
{
  "objectId": "crate",
  "meshPath": [],
  "offset": 0,
  "limit": 25
}
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
    {
      "slot": 0,
      "name": "Crate wood",
      "type": "MeshStandardMaterial",
      "editable": true,
      "color": "#B08A5A",
      "roughness": 0.8,
      "metalness": 0,
      "opacity": 1,
      "transparent": false,
      "depthWrite": true,
      "emissive": "#000000",
      "emissiveIntensity": 0,
      "side": "front",
      "textures": [
        "map"
      ]
    }
  ]
}
```

## Tips

- Standard and Physical materials are editable. Other shaders need material.replace_slot, which discards their maps and settings. Do not replace a shader just to change a colour.

## Limits

- Texture channels are named, not exposed. Creating or importing textures is not available.

## Related

- [`editor.inspect_mesh`](editor.inspect_mesh.md)
- [`editor.propose_commands`](editor.propose_commands.md)
