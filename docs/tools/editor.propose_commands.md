# `editor.propose_commands`

> Stores a batch of scene commands for review. The batch is checked against the scene and kept waiting. Nothing changes until editor.apply_proposal runs.

| | |
| --- | --- |
| Provider name | `editor__propose_commands` |
| Type | Propose (permission `propose`) |
| Approval | Never |
| Needs the editor | Yes |
| Example | Checked by the backend test on the sample scene |
| Defined in | `apps/backend/src/modules/tools/editor/editor.tools.ts` |
| In the app | Documentation → Assistant tools → Propose |

## When the assistant uses it

- For every change to the scene: read, calculate, propose, apply.
- To replace a waiting proposal when the request changes, by sending supersedes.

## Input

| Name | Type | Required | Default | Meaning |
| --- | --- | --- | --- | --- |
| `summary` | string 1–300 | Yes | – | What the batch does, in words the user will read. |
| `commands` | 1–200 commands | Yes | – | Run in order. A later command may use an object an earlier one created. |
| `expectedRevision` | integer ≥ 0 | No | – | The revision the batch was written for. Makes the proposal strict. |
| `supersedes` | identifier | No | – | A waiting proposal from this run that this one replaces. |
| `stepId` | identifier | No | – | A step of the latest plan that this batch carries out. |

## Common commands

| Item | Meaning |
| --- | --- |
| `scene.move_object` | Move by a delta. Keeps a move the user made after the read. |
| `scene.transform_object` | Set a position, rotation or scale. Overwrites moves made in between. |
| `scene.rename_object, scene.set_visibility` | Change a name or visibility without recreating the object. |
| `scene.set_parent` | Move under another object, or to the top level (null). Refused when the move cannot be exact. |
| `scene.delete_object` | Remove an object. Its children must be removed first. |
| `geometry.create_primitive, geometry.create_mesh` | Create a shape or a polygon mesh, optionally under a parent. |
| `geometry.set_modifiers, geometry.boolean` | Live modifier stacks and Boolean cuts. Strict and automatic. |
| `material.set_properties, material.assign` | Edit a slot, or assign faces to a slot. Strict; needs inspected revision. |

## Result

| Field | Meaning |
| --- | --- |
| `proposalId` | The id to pass to editor.apply_proposal or viewport.capture. |
| `status` | proposed, or rejected for a bad stepId. Later: superseded, applied, failed. |
| `requiresApproval` | Always false for assistant proposals. |
| `commandCount, baseRevision` | How many commands, and the revision they were checked on. |
| `nextAction` | The next call to make. |

## Example

Request:

```json
{
  "summary": "Raise the crate 2 units and rename it",
  "expectedRevision": 12,
  "commands": [
    {
      "commandId": "raise",
      "type": "scene.move_object",
      "objectId": "crate",
      "delta": [
        0,
        2,
        0
      ]
    },
    {
      "commandId": "rename",
      "type": "scene.rename_object",
      "objectId": "crate",
      "name": "Supply crate"
    }
  ]
}
```

Result:

```json
{
  "proposalId": "prp_7e2b9c4d1a6f4b08",
  "status": "proposed",
  "requiresApproval": false,
  "commandCount": 2,
  "baseRevision": 12,
  "supersedes": null,
  "planStep": null,
  "nextAction": "Call editor.apply_proposal with this proposalId to apply automatically."
}
```

## How it fits

```mermaid
flowchart LR
  S0["Assistant writes the commands"]
  S1["The backend checks them against the scene"]
  S2["The proposal is stored and waits"]
  S3["editor.apply_proposal applies it"]
  S0 --> S1
  S1 --> S2
  S2 --> S3
```

## Tips

- Set expectedRevision whenever the batch depends on what was read. A strict proposal fails instead of being rebased.
- Use scene.move_object for "move by". scene.transform_object sets absolute values, so it would overwrite a move the user made meanwhile.

## Limits

- At most 200 commands per proposal.
- Batches with geometry, material or hierarchy-copy commands are always strict.
- Collections and scene-graph features need an editor that supports them.

## Errors you may see

| Message | Cause |
| --- | --- |
| `stepId does not match a step of the latest plan. Record a plan first, or leave stepId out.` | The result is rejected and lists availableStepIds. Nothing is stored. |
| `Proposal conflicts with the current scene` | A command does not fit the scene. The error lists each commandId and what to fix. |

## Related

- [`editor.apply_proposal`](editor.apply_proposal.md)
- [`modeling.propose_generated`](modeling.propose_generated.md)
- [`viewport.capture`](viewport.capture.md)
