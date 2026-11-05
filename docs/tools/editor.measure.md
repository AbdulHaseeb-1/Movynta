# `editor.measure`

> Measures the geometry the editor shows: size, distance, angle, edge length or the clearance between two objects, from evaluated geometry.

| | |
| --- | --- |
| Provider name | `editor__measure` |
| Type | Read (permission `read`) |
| Approval | Never |
| Needs the editor | Yes |
| Example | Live editor output; the test checks its shape |
| Defined in | `apps/backend/src/modules/tools/editor/editor.tools.ts` |
| In the app | Documentation → Assistant tools → Read |

## When the assistant uses it

- When the user asks how big something is, how far apart two things are, or whether two objects touch.
- To confirm a placement after it has been applied.

## Input

| Name | Type | Required | Default | Meaning |
| --- | --- | --- | --- | --- |
| `request` | measurement request | Yes | – | One of five kinds, selected by request.kind (see the table). |

## Measurement kinds

| Item | Meaning |
| --- | --- |
| `dimensions` | target {objectId, meshPath?, descendants?} and space (world default, or local). Returns bounds, size, center. |
| `distance` | from and to, each a point or a vertex reference {objectId, vertex, revision}. Returns delta and length. |
| `edge` | objectId, revision and an edge id a_b. Returns endpoints and length. |
| `angle` | from, at and to. Returns degrees at the middle point. |
| `clearance` | first and second targets, method bounds (axis gaps) or surface (closest boundary distance). Returns distance and axisGap. |

## Result

| Field | Meaning |
| --- | --- |
| `revision` | The scene revision. Use it for placement proposals. |
| `units` | null, or the display unit and metersPerSceneUnit. |
| `result` | { status: ok, data } or { status: unavailable, message } with the reason. |

## Example

Request:

```json
{
  "request": {
    "kind": "clearance",
    "first": {
      "objectId": "torso"
    },
    "second": {
      "objectId": "crate"
    },
    "method": "bounds"
  }
}
```

Result:

```json
{
  "revision": 12,
  "units": null,
  "result": {
    "status": "ok",
    "data": {
      "kind": "clearance",
      "method": "bounds",
      "distance": 2,
      "firstBounds": {
        "min": [
          -0.5,
          0.25,
          -0.3
        ],
        "max": [
          0.5,
          1.75,
          0.3
        ]
      },
      "secondBounds": {
        "min": [
          2.5,
          0,
          -0.5
        ],
        "max": [
          3.5,
          1,
          0.5
        ]
      },
      "axisGap": [
        2,
        0,
        0
      ],
      "secondParentWorldInverse": [
        1,
        0,
        0,
        0,
        0,
        1,
        0,
        0,
        0,
        0,
        1,
        0,
        0,
        0,
        0,
        1
      ]
    }
  }
}
```

## Tips

- Measure again after applying a placement, particularly when a Boolean changes the shape.
- Use surface clearance to find touching or intersecting objects. Bounds clearance only gives axis gaps.

## Limits

- Surface clearance is limited to 20,000 triangles per target and a bounded amount of work.
- Skinned and morph-deformed meshes allow dimensions, but not component references.
- Lengths are scene units unless the project is calibrated.

## Related

- [`editor.plan_placement`](editor.plan_placement.md)
- [`editor.inspect_mesh`](editor.inspect_mesh.md)
