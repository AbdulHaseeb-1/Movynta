# `editor.plan_duplicates`

> Plans independent copies of an object and everything under it. Each copy gets fresh ids and an offset. It returns one scene.duplicate_hierarchy command.

| | |
| --- | --- |
| Provider name | `editor__plan_duplicates` |
| Type | Read (permission `read`) |
| Approval | Never |
| Needs the editor | Yes |
| Example | Checked by the backend test on the sample scene |
| Defined in | `apps/backend/src/modules/tools/editor/duplication.tools.ts` |
| In the app | Documentation → Assistant tools → Read |

## When the assistant uses it

- To make a row, a grid or a stack of copies of a finished part.
- For a row of new simple shapes, modeling.generate_commands is the alternative.

## Input

| Name | Type | Required | Default | Meaning |
| --- | --- | --- | --- | --- |
| `sourceId` | identifier | Yes | – | The object to copy. Its descendants are copied with it. |
| `copies` | integer 1–63 | Yes | – | Additional copies. |
| `offset` | [x, y, z] | Yes | – | Within ±100000 per axis. Copy n moves by offset × n. |
| `space` | parent \| world | No | `parent` | Whether the offset is in the parent's axes or in world axes. |
| `name` | string 1–80 | No | – | A label for the copies' roots. Names are numbered among siblings when applied. |

## Result

| Field | Meaning |
| --- | --- |
| `sourceRevision` | Propose with this as expectedRevision. |
| `commands` | One scene.duplicate_hierarchy command with a new objectId for each root and each registered descendant. |
| `nextAction` | The next step. |

## Example

Request:

```json
{
  "sourceId": "figure",
  "copies": 2,
  "offset": [
    2.5,
    0,
    0
  ],
  "space": "world",
  "name": "Figure copy"
}
```

Result:

```json
{
  "sourceRevision": 12,
  "commands": [
    {
      "commandId": "duplicate",
      "type": "scene.duplicate_hierarchy",
      "sourceId": "figure",
      "offset": [
        2.5,
        0,
        0
      ],
      "space": "world",
      "copies": [
        {
          "objectId": "obj_9a1e6c2f-3b7d-4e5a-8c9f-1d2e3f4a5b60",
          "name": "Figure copy",
          "descendants": [
            {
              "sourceId": "torso",
              "objectId": "obj_0f7c4d2a-6e1b-4a9d-b3c8-5e2f1a7d9c10"
            },
            {
              "sourceId": "arm_left",
              "objectId": "obj_2b8e5a13-9d4f-4c6e-a1b7-7f3e0c2d8a21"
            },
            {
              "sourceId": "arm_right",
              "objectId": "obj_c4d19e7f-1a2b-4f3c-8d5e-6a9b0c1e2f32"
            }
          ]
        },
        {
          "objectId": "obj_e83a6b05-4c2d-4e1f-9b7a-3d8c5f6e0a43",
          "name": "Figure copy",
          "descendants": [
            {
              "sourceId": "torso",
              "objectId": "obj_15f0c9d2-7b8e-4a6f-8c3d-2e9a1b4f7c54"
            },
            {
              "sourceId": "arm_left",
              "objectId": "obj_a6d2e8b4-0c5f-4d7a-9e1b-8f3c2a6d5e65"
            },
            {
              "sourceId": "arm_right",
              "objectId": "obj_7c9b3f1e-2d6a-4b8e-a0f4-1c5d9e7b3a76"
            }
          ]
        }
      ]
    }
  ],
  "nextAction": "Propose these commands with expectedRevision: sourceRevision, then apply and inspect the copies."
}
```

## How it fits

```mermaid
flowchart LR
  S0["Read the hierarchy at the current revision"]
  S1["Generate fresh ids for each copy root and descendant"]
  S2["Propose one scene.duplicate_hierarchy command"]
  S3["Apply it, then inspect a copy"]
  S0 --> S1
  S1 --> S2
  S2 --> S3
```

## Tips

- Copies are independent: geometry, materials and skeletons are separate. Texture images are shared.
- Ids change on every call, so refer to copies by name after they are applied.

## Limits

- The scene may hold 2000 objects, copies included. Geometry is budgeted at 128 MiB.
- A skinned hierarchy must include all of its bones, or the copy is rejected.

## Errors you may see

| Message | Cause |
| --- | --- |
| `Update the editor for hierarchy duplication` | The connected editor does not report supportsRepetition. |
| `Source object does not exist` | sourceId is not in the scene. |
| `Copies exceed the 2000-object scene limit` | The copies would take the scene past 2000 objects. |

## Related

- [`editor.propose_commands`](editor.propose_commands.md)
- [`editor.plan_placement`](editor.plan_placement.md)
- [`modeling.generate_commands`](modeling.generate_commands.md)
