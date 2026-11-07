# `modeling.record_brief`

> Writes down what the finished work must be as checks that code can pass or fail: sizes, placement, symmetry and counts. Recording a brief changes nothing in the scene.

| | |
| --- | --- |
| Provider name | `modeling__record_brief` |
| Type | Plan (permission `plan`) |
| Approval | Never |
| Needs the editor | No |
| Example | Checked by the backend test on the sample scene |
| Defined in | `apps/backend/src/modules/tools/modeling/brief.tools.ts` |
| In the app | Documentation → Assistant tools → Plan |

## When the assistant uses it

- After reading the scene and before the plan, for any request that builds or reshapes something.
- Whenever a request has a measurable meaning: real proportions, parts resting on what carries them, left and right matching, details inside their parent.
- Skip it for a rename, a move or a question.

## Input

The brief is what the run is held to: it is not finished while a check fails.

| Name | Type | Required | Default | Meaning |
| --- | --- | --- | --- | --- |
| `subject` | string 1–200 | Yes | – | What is being made. |
| `style` | string up to 200 | No | – | The look asked for, such as low poly or realistic. |
| `assumptions` | up to 8 strings | No | – | Choices made where the user gave no detail, such as the scale. They are for the user to read. |
| `checks` | array of 1–40 checks | Yes | – | Measurable statements about the finished scene. Each kind is described below. |

## Naming an object

| Item | Meaning |
| --- | --- |
| `id` | The object's id. |
| `name` | Its exact name, ignoring letter case. Must match one object when the check is measured. |
| `namePrefix` | Names that start with this text, such as Leg for Leg, Leg.001 and Leg.002. Only the count check takes it. |

## Check kinds

| Item | Meaning |
| --- | --- |
| `count` | How many objects match: at least min (default 1) and at most max. |
| `size` | The extent of target along axis, between min and max. |
| `position` | Where the low edge (min), middle (center) or high edge (max) of target lies on axis, between min and max. Lowest point on the floor: anchor min, min 0, max 0. |
| `gap` | From the high edge of first to the low edge of second along axis. 0 is touching, negative is overlapping. |
| `symmetric` | second mirrors first across the plane where axis equals planeAt (default 0), within tolerance. |
| `aligned` | first and second have the same center on axis, within tolerance. |
| `contained` | inner lies inside outer on every axis, within tolerance. |
| `connected` | Every mesh at or under group touches the rest, directly or through other parts, within tolerance (default 1% of the group's largest side). Names the parts that are detached. Touching means the bounds meet, which is necessary for contact but not proof of it. |

## Measuring

| Item | Meaning |
| --- | --- |
| `Bounds` | World-space axis-aligned bounds in scene units. A group's bounds include its parts, so name a whole thing by its group. |
| `tolerance` | Scene units. Left out, 2% of the largest side of the objects compared (1% for contained). |
| `label` | Optional name for a check, up to 120 characters, shown in results. |

## Result

| Field | Meaning |
| --- | --- |
| `status: recorded` | checkCount, replaced and next. A warning appears when a brief with failing checks was replaced. |

## Example

Request:

```json
{
  "subject": "A figure with two matching arms, standing beside a crate",
  "assumptions": [
    "One scene unit is one meter",
    "The figure is about as tall as a person"
  ],
  "checks": [
    {
      "kind": "size",
      "label": "Figure is about as tall as a person",
      "target": {
        "name": "Figure"
      },
      "axis": "y",
      "min": 1.5,
      "max": 1.9
    },
    {
      "kind": "position",
      "label": "Figure stands on the floor",
      "target": {
        "name": "Figure"
      },
      "axis": "y",
      "anchor": "min",
      "min": 0,
      "max": 0
    },
    {
      "kind": "position",
      "label": "Crate rests on the floor",
      "target": {
        "name": "Crate"
      },
      "axis": "y",
      "anchor": "min",
      "min": 0,
      "max": 0
    },
    {
      "kind": "symmetric",
      "label": "Arms mirror each other",
      "first": {
        "id": "arm_left"
      },
      "second": {
        "id": "arm_right"
      },
      "axis": "x"
    }
  ]
}
```

Result:

```json
{
  "status": "recorded",
  "checkCount": 4,
  "replaced": false,
  "next": "Build the model, then call validation.check_brief after the changes are applied."
}
```

## Tips

- Write checks for what makes this subject right, not for what is easy to pass.
- Name objects the way the plan will create them. The objects need not exist when the brief is recorded.
- Recording again replaces the brief. The user is told at the end how many times it changed, so change a check only when it was wrong.

## Limits

- Checks measure bounds, so they prove sizes, placement, mirroring and that parts meet, but not shape or appearance.
- Bounds are axis-aligned boxes: a turned part can fail a size check that its true shape would pass.
- An editor that does not report bounds leaves the checks unmeasurable; the final reply says so.

## Errors you may see

| Message | Cause |
| --- | --- |
| `Give exactly one of id, name or namePrefix` | A check named an object in more than one way, or in none. |
| `namePrefix is only for count checks; use id or name` | A size, position, gap, symmetric, aligned or contained check pointed at several objects. |

## Related

- [`validation.check_brief`](validation.check_brief.md)
- [`modeling.generate_model_plan`](modeling.generate_model_plan.md)
- [`modeling.assess_quality`](modeling.assess_quality.md)
