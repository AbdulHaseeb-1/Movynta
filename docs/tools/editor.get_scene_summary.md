# `editor.get_scene_summary`

> Counts the objects by type and reports what is selected. A quick orientation before a larger read.

| | |
| --- | --- |
| Provider name | `editor__get_scene_summary` |
| Type | Read (permission `read`) |
| Approval | Never |
| Needs the editor | Yes |
| Example | Checked by the backend test on the sample scene |
| Defined in | `apps/backend/src/modules/tools/editor/editor.tools.ts` |
| In the app | Documentation → Assistant tools → Read |

## When the assistant uses it

- When the assistant needs the size and shape of the scene without the full object list.
- Before choosing how to read a large scene: with more than about 60 objects, continue with editor.read_branch.

## Input

No input. Send an empty object.

## Result

| Field | Meaning |
| --- | --- |
| `revision` | The scene revision. |
| `activeSceneName` | The open scene's name, or null. |
| `objectCount` | Total objects. |
| `countsByType` | How many objects of each type. Only types that occur are listed. |
| `selectedObjectIds` | The selected object ids. |

## Example

Request:

```json
{}
```

Result:

```json
{
  "revision": 12,
  "activeSceneName": "Main",
  "objectCount": 6,
  "countsByType": {
    "empty": 2,
    "mesh": 4
  },
  "selectedObjectIds": [
    "crate"
  ]
}
```

## Tips

- It reports counts and selection only. For parents, transforms or names, use editor.get_context.

## Limits

- No positions, names or parents in the result.

## Related

- [`editor.read_branch`](editor.read_branch.md)
- [`editor.get_context`](editor.get_context.md)
