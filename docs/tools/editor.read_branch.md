# `editor.read_branch`

> Reads the scene as a tree, one branch at a time. Each entry carries a summary, and runs of look-alike siblings fold into one entry, so the answer grows with what the scene contains, not with its object count.

| | |
| --- | --- |
| Provider name | `editor__read_branch` |
| Type | Read (permission `read`) |
| Approval | Never |
| Needs the editor | Yes |
| Example | Checked by the backend test on the sample scene |
| Defined in | `apps/backend/src/modules/tools/scene/scene.tools.ts` |
| In the app | Documentation → Assistant tools → Read |

## When the assistant uses it

- First, on any scene with more than about 60 objects, instead of reading the whole flat list.
- To find the id of a part by its place in the hierarchy.
- To see how big a group is and what it holds before deciding to open it.

## Input

Every field is optional. Send {} for the top level.

| Name | Type | Required | Default | Meaning |
| --- | --- | --- | --- | --- |
| `rootId` | identifier | No | – | The object to open. Leave out for the top of the scene. |
| `depth` | integer 1–4 | No | `1` | How many levels to open below the root. A level that stays closed shows only counts. |
| `childLimit` | integer 1–100 | No | `30` | Entries listed per level. |
| `childOffset` | integer ≥ 0 | No | `0` | Entries to skip at the opened level, for paging. Use the nextOffset a result gives. |
| `foldRepeats` | boolean | No | `true` | Shows 4 or more look-alike siblings as one entry. Set false to list every sibling. |

## Result

| Field | Meaning |
| --- | --- |
| `revision, objectCount` | The scene revision, and the number of objects in the whole scene. |
| `countsByType` | Objects by type, for the whole scene. Only when no rootId is given. |
| `node` | The opened object: id, name, type, visible, size and center in world axes, childCount, descendantCount and descendants by type. Not present at the top level. |
| `path` | The id and name of each object from the top of the scene down to the opened one. |
| `children` | The entries of the level, each with the same summary and, when depth allows, its own children and childrenOmitted. A folded run is { repeat: true, name, type, count, templateId, exampleIds, size, descendantsEach }. |
| `childrenOmitted, nextOffset` | Entries not returned at the opened level, and the childOffset that continues the listing. |
| `truncated` | True when the read stopped opening branches at its limit of 300 entries. |
| `unreachable` | Objects left out because their parents form a cycle. Present only when there are some. |

## Example

Request:

```json
{
  "rootId": "figure"
}
```

Result:

```json
{
  "revision": 12,
  "objectCount": 6,
  "children": [
    {
      "id": "torso",
      "name": "Torso",
      "type": "mesh",
      "visible": true,
      "size": [
        1,
        1.5,
        0.6
      ],
      "center": [
        0,
        1,
        0
      ],
      "childCount": 0,
      "descendantCount": 0
    },
    {
      "id": "arm_left",
      "name": "Arm",
      "type": "mesh",
      "visible": true,
      "size": [
        0.3,
        1.2,
        0.3
      ],
      "center": [
        -0.9,
        1.2,
        0
      ],
      "childCount": 0,
      "descendantCount": 0
    },
    {
      "id": "arm_right",
      "name": "Arm",
      "type": "mesh",
      "visible": true,
      "size": [
        0.3,
        1.2,
        0.3
      ],
      "center": [
        0.9,
        1.2,
        0
      ],
      "childCount": 0,
      "descendantCount": 0
    }
  ],
  "childrenOmitted": 0,
  "truncated": false,
  "node": {
    "id": "figure",
    "name": "Figure",
    "type": "empty",
    "visible": true,
    "size": [
      2.1,
      1.55,
      0.6
    ],
    "center": [
      0,
      1.025,
      0
    ],
    "childCount": 3,
    "descendantCount": 3,
    "descendants": {
      "mesh": 3
    }
  },
  "path": [
    {
      "id": "figure",
      "name": "Figure"
    }
  ]
}
```

## Tips

- Open a branch only when you need it. A folded entry stands for many objects; its templateId is one of them.
- size and center are world-space and include what is inside the object, so a group's size is the size of the whole assembly.
- Use editor.get_context for exact transforms of objects you have already chosen, not to find them.

## Limits

- One read returns at most 300 entries, and a level at most childLimit.
- Folding compares type, name (ignoring numbering), size and contents, not geometry.

## Errors you may see

| Message | Cause |
| --- | --- |
| `rootId "…" is not in the scene; read the scene with editor.read_branch to find the id` | rootId names no object, or an object caught in a parent cycle. |

## Related

- [`editor.find_repeats`](editor.find_repeats.md)
- [`editor.query_objects`](editor.query_objects.md)
- [`editor.get_context`](editor.get_context.md)
- [`editor.get_scene_summary`](editor.get_scene_summary.md)
