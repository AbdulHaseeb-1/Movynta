# `editor.describe_commands`

> Returns the full rules of the editor commands asked for: fields, limits, batching and what each refuses. editor.propose_commands lists every command in one line, so the details are read only when needed.

| | |
| --- | --- |
| Provider name | `editor__describe_commands` |
| Type | Read (permission `read`) |
| Approval | Never |
| Needs the editor | No |
| Example | Checked by the backend test on the sample scene |
| Defined in | `apps/backend/src/modules/tools/editor/command-reference.ts` |
| In the app | Documentation → Assistant tools → Read |

## When the assistant uses it

- Before the first geometry or material command of a kind in a run.
- When a proposal was refused and the issue does not make the fix clear.

## Input

| Name | Type | Required | Default | Meaning |
| --- | --- | --- | --- | --- |
| `types` | 1–12 command types | Yes | – | Command types such as geometry.bisect. Repeats are answered once. |

## Result

| Field | Meaning |
| --- | --- |
| `commands[]` | For each known type: type, summary (the line editor.propose_commands shows) and rules. |
| `unknown[]` | Types that are not commands, each with the three closest valid types. |

## Example

Request:

```json
{
  "types": [
    "geometry.flip_normals",
    "geometry.flip_faces"
  ]
}
```

Result:

```json
{
  "commands": [
    {
      "type": "geometry.flip_normals",
      "summary": "Reverses whole connected surfaces: omit ids for all, or list base faces and each surface containing one flips.",
      "rules": "IDs are unchanged, so it can share a component-edit batch."
    }
  ],
  "unknown": [
    {
      "type": "geometry.flip_faces",
      "closest": [
        "geometry.flip_normals",
        "geometry.inset_faces",
        "geometry.slide_edges"
      ]
    }
  ]
}
```

## Tips

- Ask for every type a batch will use in one call.
- The command list in editor.propose_commands and these rules come from the same table, so they always agree.

## Limits

- Reads nothing from the scene; use editor.inspect_mesh or editor.get_context for ids and revisions.
- At most 12 types per call.

## Related

- [`editor.propose_commands`](editor.propose_commands.md)
- [`editor.inspect_mesh`](editor.inspect_mesh.md)
