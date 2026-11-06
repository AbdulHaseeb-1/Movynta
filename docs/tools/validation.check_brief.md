# `validation.check_brief`

> Measures the recorded brief against the current scene and reports each check as pass, fail or unresolved, with what was measured and what was needed.

| | |
| --- | --- |
| Provider name | `validation__check_brief` |
| Type | Read (permission `read`) |
| Approval | Never |
| Needs the editor | Yes |
| Example | Checked by the backend test on the sample scene |
| Defined in | `apps/backend/src/modules/tools/modeling/brief.tools.ts` |
| In the app | Documentation → Assistant tools → Read |

## When the assistant uses it

- After applying changes, as the step that follows validation.check_scene.
- Again after every fix, until no check fails. The run is not finished while a check fails or the scene changed since the last measurement.

## Input

No input. Send an empty object.

## Statuses

| Item | Meaning |
| --- | --- |
| `pass` | The measured value is inside what the check needs. |
| `fail` | The model is wrong or the check was. measured and expected show by how much. |
| `unresolved` | The check could not be measured: the object does not exist yet, several objects have that name, or it has no geometry. measured says which. |

## Result

| Field | Meaning |
| --- | --- |
| `status` | pass, fail, unmeasurable (the editor sent no bounds) or rejected (no brief recorded). |
| `revision` | The scene revision that was measured. |
| `passed / failed / unresolved` | Counts of checks. |
| `results[]` | For each check: index, label, kind, status, measured and expected. |

## Example

Request:

```json
{}
```

Result:

```json
{
  "status": "fail",
  "revision": 12,
  "passed": 3,
  "failed": 1,
  "unresolved": 0,
  "results": [
    {
      "index": 0,
      "label": "Figure is about as tall as a person",
      "kind": "size",
      "status": "pass",
      "measured": "1.55",
      "expected": "between 1.5 and 1.9"
    },
    {
      "index": 1,
      "label": "Figure stands on the floor",
      "kind": "position",
      "status": "fail",
      "measured": "0.25",
      "expected": "exactly 0"
    },
    {
      "index": 2,
      "label": "Crate rests on the floor",
      "kind": "position",
      "status": "pass",
      "measured": "0",
      "expected": "exactly 0"
    },
    {
      "index": 3,
      "label": "Arms mirror each other",
      "kind": "symmetric",
      "status": "pass",
      "measured": "exact mirror",
      "expected": "within 0.024"
    }
  ]
}
```

## Tips

- Fix every fail and unresolved check, then measure again. Do not loosen a check to make it pass unless it was wrong, and say so in the reply.
- A passing brief is not a finished model. Look at the scene with viewport.capture for shape and appearance.

## Limits

- It reads the snapshot only and cannot find parts that overlap without being listed in a check.
- Only changes the run applied are tracked: a change made by the user in between is measured the next time it runs.

## Errors you may see

| Message | Cause |
| --- | --- |
| `No brief is recorded. Call modeling.record_brief first.` | Checking before recording. |

## Related

- [`modeling.record_brief`](modeling.record_brief.md)
- [`validation.check_scene`](validation.check_scene.md)
- [`viewport.capture`](viewport.capture.md)
- [`modeling.assess_quality`](modeling.assess_quality.md)
