# `editor.get_scene_summary`

Counts the objects in the scene by type and reports what is selected. A quick orientation before a larger read.

| | |
| --- | --- |
| Provider name | `editor__get_scene_summary` |
| Permission | `read` (never needs approval) |
| Needs the editor | Yes |
| Defined in | `apps/backend/src/modules/tools/editor/editor.tools.ts` |
| Demo | [Read tab](demos/index.html#read) |

## When the assistant uses it

When it needs to know what kind of scene it is in (how many objects, whether anything is selected) without the full object list. For parents, transforms or names, use [`editor.get_context`](editor.get_context.md).

## Input

None. The input must be `{}`.

## Result

| Field | Meaning |
| --- | --- |
| `revision` | The scene revision. |
| `activeSceneName` | The open scene's name, or `null`. |
| `objectCount` | Total objects. |
| `countsByType` | How many objects of each `type`. Only types that occur are listed. |
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
  "countsByType": { "empty": 2, "mesh": 4 },
  "selectedObjectIds": ["crate"]
}
```

## Visual example

Counts by type, drawn to scale:

```text
objectCount 6          revision 12
empty  ██████░░░░░░░░░░░░░░  2   (Figure, Props)
mesh   ████████████████████  4   (Torso, Arm, Arm, Crate)
selected: crate
```

## How it fits

The tool calls the editor once, then counts `objects` by `type`. It is the cheapest way to read the scene, and it does not change anything.

## Limits and errors

- It reports only counts, selection and revision. It cannot say where an object is.
- Like every editor tool, it fails with a connection error when no editor is connected.

## Related

- [`editor.get_context`](editor.get_context.md) for the full snapshot.
