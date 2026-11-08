# `editor.find_repeats`

> Finds objects that look like copies of one another and says how they are laid out, so a repeated part is one idea to change instead of many objects.

| | |
| --- | --- |
| Provider name | `editor__find_repeats` |
| Type | Read (permission `read`) |
| Approval | Never |
| Needs the editor | Yes |
| Example | Checked by the backend test on the sample scene |
| Defined in | `apps/backend/src/modules/tools/scene/scene.tools.ts` |
| In the app | Documentation → Assistant tools → Read |

## When the assistant uses it

- Before editing a scene with many similar parts, such as windows, posts, tiles or rivets.
- To learn the spacing of an array so it can be reproduced with editor.plan_duplicates.
- To spot copies that were piled in one place by mistake.

## Input

Every field is optional.

| Name | Type | Required | Default | Meaning |
| --- | --- | --- | --- | --- |
| `rootId` | identifier | No | – | Search only below this object. Leave out to search the whole scene. |
| `minCount` | integer 2–500 | No | `3` | The smallest number of look-alikes that counts as a group. |
| `limit` | integer 1–20 | No | `10` | Groups returned, the ones standing for most of the scene first. |

## Result

| Field | Meaning |
| --- | --- |
| `revision` | The scene revision. |
| `scanned, covered` | Objects looked at, and objects inside the groups returned, members and what they hold. |
| `groups[].name, type, count` | The shared name without its numbering, the type, and the number of members. |
| `groups[].templateId, memberIds` | The member to treat as the original, and the first 50 member ids. memberIdsOmitted counts the rest. |
| `groups[].size, descendantsEach` | World size of one member, and how many objects each holds. |
| `groups[].parentIds, parentCount` | Up to five distinct parents, and how many there are. |
| `groups[].arrangement` | line { axis, count, step }, grid { axes, counts, steps }, coincident (all in one place) or scattered, from the members' world centers. |
| `omittedGroups` | Groups that matched but are past the limit. |
| `confidence` | A reminder that matching used names, sizes and structure, not geometry. |

## Example

Request:

```json
{
  "minCount": 2
}
```

Result:

```json
{
  "revision": 12,
  "scanned": 6,
  "covered": 2,
  "groups": [
    {
      "name": "Arm",
      "type": "mesh",
      "count": 2,
      "templateId": "arm_left",
      "memberIds": [
        "arm_left",
        "arm_right"
      ],
      "memberIdsOmitted": 0,
      "size": [
        0.3,
        1.2,
        0.3
      ],
      "descendantsEach": 0,
      "parentIds": [
        "figure"
      ],
      "parentCount": 1,
      "arrangement": {
        "kind": "line",
        "axis": "x",
        "count": 2,
        "step": 1.8
      }
    }
  ],
  "omittedGroups": 0,
  "confidence": "Matched by type, name, size and contents; geometry is not compared."
}
```

## Tips

- A repeated group is reported once; the frames and panes inside repeated windows are not listed again.
- A line or grid maps onto editor.plan_duplicates: sourceId is templateId, offset is the step on the axis.
- Confirm with editor.inspect_mesh on templateId and one other member before treating them as identical.

## Limits

- Matches by type, name (ignoring trailing numbers and "copy"), world size to about 3 significant digits and contents. Geometry and materials are not compared.
- Copies turned by other than a quarter turn, or scaled differently, are not matched.
- Objects with no bounds cannot be compared and are skipped.

## Errors you may see

| Message | Cause |
| --- | --- |
| `rootId "…" is not in the scene; read the scene with editor.read_branch to find the id` | rootId names no object. |

## Related

- [`editor.read_branch`](editor.read_branch.md)
- [`editor.plan_duplicates`](editor.plan_duplicates.md)
- [`editor.inspect_mesh`](editor.inspect_mesh.md)
