# `editor.query_objects`

> Selects objects by rule, such as name, type, parent, size or position, so a group of objects can be named by what they are instead of by id.

| | |
| --- | --- |
| Provider name | `editor__query_objects` |
| Type | Read (permission `read`) |
| Approval | Never |
| Needs the editor | Yes |
| Example | Checked by the backend test on the sample scene |
| Defined in | `apps/backend/src/modules/tools/scene/scene.tools.ts` |
| In the app | Documentation → Assistant tools → Read |

## When the assistant uses it

- To find every object of a kind, for example all windows above the second floor.
- To count objects before and after an edit.
- To get the ids for one batch of commands without reading the whole scene.

## Input

Every field is optional, and every filter given must hold.

| Name | Type | Required | Default | Meaning |
| --- | --- | --- | --- | --- |
| `nameMatches` | string 1–80 | No | – | A pattern for the object's own name. * is any run of characters, ? is one; case is ignored. |
| `type` | list of mesh \| empty \| collection \| camera \| light | No | – | Keep only these types. |
| `parentId` | identifier \| null | No | – | Direct children of this object. null selects the top level. |
| `withinId` | identifier | No | – | Everything below this object, at any depth. |
| `visible, selected` | boolean | No | – | Filter on the object's own visibility flag, or on whether it is selected. |
| `size` | { x?, y?, z? } of { min?, max? } | No | – | Ranges on the world extents, including what is inside. Objects with no geometry never match. |
| `position` | { x?, y?, z? } of { min?, max? } | No | – | Ranges on the world center of the object's bounds. Objects with no geometry never match. |
| `sortBy` | scene \| name \| size \| x \| y \| z | No | `scene` | size orders by volume; x, y and z by the center on that axis. |
| `descending` | boolean | No | `false` | Reverse the order. |
| `limit, offset` | integer 1–200, integer ≥ 0 | No | `50, 0` | Page the matches. |
| `countOnly` | boolean | No | `false` | Return only the total. |

## Result

| Field | Meaning |
| --- | --- |
| `revision` | The scene revision the matches belong to. |
| `total` | Every object that matched, whatever the limit. |
| `matches` | The page of matches: id, name, type, parentId, size and center (world axes). |
| `hasMore, nextOffset` | Whether more matches follow, and the offset that continues. |

## Example

Request:

```json
{
  "nameMatches": "arm*",
  "position": {
    "x": {
      "max": 0
    }
  }
}
```

Result:

```json
{
  "revision": 12,
  "total": 1,
  "matches": [
    {
      "id": "arm_left",
      "name": "Arm",
      "type": "mesh",
      "parentId": "figure",
      "size": [
        0.3,
        1.2,
        0.3
      ],
      "center": [
        -0.9,
        1.2,
        0
      ]
    }
  ],
  "hasMore": false
}
```

## Tips

- Matches describe the scene at the revision returned. After an edit, query again.
- Combine withinId with a name pattern to select one kind of part inside one branch.
- Use countOnly to check an edit worked without reading the objects.

## Limits

- At most 200 matches per call; page with offset.
- size and position use the editor's world bounds, which include descendants.

## Errors you may see

| Message | Cause |
| --- | --- |
| `withinId "…" is not in the scene; read the scene with editor.read_branch to find the id` | withinId or parentId names no object. |

## Related

- [`editor.read_branch`](editor.read_branch.md)
- [`editor.find_repeats`](editor.find_repeats.md)
- [`editor.plan_placement`](editor.plan_placement.md)
