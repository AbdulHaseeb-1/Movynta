# `validation.check_scene`

> Checks the scene for structural problems and reports each with a severity: errors, warnings and information.

| | |
| --- | --- |
| Provider name | `validation__check_scene` |
| Type | Read (permission `read`) |
| Approval | Never |
| Needs the editor | Yes |
| Example | Checked by the backend test on the sample scene |
| Defined in | `apps/backend/src/modules/tools/validation/validation.tools.ts` |
| In the app | Documentation → Assistant tools → Read |

## When the assistant uses it

- As the last step of a change, after the proposal is applied. The mesh-editing and character-modeling skills both do this.
- When the user asks whether the scene is in order.

## Input

No input. Send an empty object.

## What is checked

| Item | Meaning |
| --- | --- |
| `error · ids and parents` | Duplicate object ids; a parent that does not exist; a parent chain that loops. |
| `error · scale` | A scale that is zero or negative on any axis. |
| `error · collections` | A collection in a missing collection or inside itself; an object in a missing collection. |
| `warning · names` | Two objects with the same name under one parent (the later one is reported); two collections with the same name in one place. |
| `warning · structure` | A group with children scaled by different amounts on different axes, and a selected id that is not in the scene. |
| `warning · size` | More than 500 objects, where checks may be slow to review. |
| `info` | A group with no children, or a collection with nothing in it. |

## Result

| Field | Meaning |
| --- | --- |
| `ok` | false only when there is at least one error. |
| `objectCount` | Objects in the snapshot. |
| `issues[]` | severity, objectId (null for a collection or scene-wide issue) and message. |

## Example

Request:

```json
{}
```

Result:

```json
{
  "ok": true,
  "objectCount": 6,
  "issues": [
    {
      "severity": "warning",
      "objectId": "arm_right",
      "message": "Shares the name \"Arm\" with another object under the same parent; rename one so each can be told apart"
    },
    {
      "severity": "info",
      "objectId": "props",
      "message": "Group has no children"
    }
  ]
}
```

## Tips

- A warning does not stop an edit. But a later move under or out of an unevenly scaled group is refused, so fix that warning first.

## Limits

- It reads the snapshot only. It cannot find self-intersections or overlaps; use editor.measure or viewport.capture for those.

## Related

- [`editor.get_context`](editor.get_context.md)
- [`editor.apply_proposal`](editor.apply_proposal.md)
- [`viewport.capture`](viewport.capture.md)
