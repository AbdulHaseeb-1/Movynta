# Assistant tools

This file lists every tool the modeling assistant can call, the editor commands those tools accept, and the rules that decide when a person must approve a change.

It is the reference for the assistant's capabilities. Keep it in step with the code: [AGENTS.md](../AGENTS.md) ("Assistant tools") says when to update it.

## Tool inventory

The modeling coordinator agent (`apps/backend/src/modules/agents/definitions/modeling-coordinator.agent.ts`) receives every tool in the registry, so each tool below is available to it on every run. Model-facing names replace the dot with two underscores (`editor.get_context` is sent as `editor__get_context`).

| Tool | Provider name | Permission | Approval | What it does | Defined in |
| --- | --- | --- | --- | --- | --- |
| `editor.get_context` | `editor__get_context` | `read` | Never | Returns the editor scene: objects, parents, visibility, selection and revision. | `modules/tools/editor/editor.tools.ts` |
| `editor.get_scene_summary` | `editor__get_scene_summary` | `read` | Never | Returns object counts by type, selection and revision. | `modules/tools/editor/editor.tools.ts` |
| `editor.propose_commands` | `editor__propose_commands` | `propose` | Decided per proposal (see below) | Stores a batch of commands for preview. Nothing changes in the scene yet. Can replace a waiting proposal (`supersedes`) and name the plan step it carries out (`stepId`). | `modules/tools/editor/editor.tools.ts` |
| `editor.apply_proposal` | `editor__apply_proposal` | `apply` | Decided per proposal; an unknown proposal always needs approval | Applies a stored proposal to the editor. | `modules/tools/editor/editor.tools.ts` |
| `validation.check_scene` | `validation__check_scene` | `read` | Never | Checks duplicate ids, missing parents, parent cycles, and non-positive scale. | `modules/tools/validation/validation.tools.ts` |
| `skills.load_skill` | `skills__load_skill` | `skill` | Never | Loads the full workflow of a skill selected for this request. | `modules/tools/skills/skills.tools.ts` |
| `modeling.generate_model_plan` | `modeling__generate_model_plan` | `plan` | Never | Records a structured plan. It does not change the scene. Each step's `toolName` must be a known tool. A newer plan replaces the current one. | `modules/tools/modeling/modeling.tools.ts` |

### Permissions

Each tool declares one permission (`TOOL_PERMISSIONS` in `modules/tools/tool.types.ts`):

- `read`: looks at the scene or checks it.
- `plan`: records intent without changing anything.
- `propose`: stores a batch of commands for review.
- `apply`: changes the scene.
- `skill`: loads instructions for a selected skill.

## Proposals

A proposal is a stored batch of scene commands. The assistant writes it, the backend checks it against the scene, and it waits there until it is applied, rejected or replaced. The assistant can never change the scene without a proposal.

### Lifecycle

| Status | Meaning |
| --- | --- |
| `proposed` | Stored and checked. Waiting to be applied, rejected or superseded. |
| `applying` | Being sent to the editor. |
| `applied` | The editor ran the batch. The commands are saved in the project history. |
| `failed` | The editor refused the batch, or it no longer fits the scene. Nothing changed. |
| `rejected` | The user refused it while it was still `proposed`. |
| `superseded` | Replaced by a newer proposal while it was still `proposed`. It can no longer be applied. |

### Rebasing

The batch is written against the scene revision it was checked on. If the scene changes before the batch is applied, the editor reports a revision conflict. The backend then re-checks the batch against the current scene:

- If every command still fits, the batch runs again on the current scene and the result has `rebased: true`.
- If a command no longer fits (for example its object was deleted), the proposal fails with a message that says the scene changed, and the assistant must propose again.

Rebasing keeps the batch's absolute values. A transform sets the object's position, so it overwrites a manual move made in between. Rebasing does not check which objects the user changed.

### Superseding

`editor.propose_commands` accepts `supersedes`, the id of a waiting proposal from the same run. The new proposal is checked first. If it passes, the old proposal becomes `superseded`. A proposal that was already applied or rejected cannot be superseded.

### Plan steps

`editor.propose_commands` accepts `stepId`, a step id of the latest recorded plan. If it matches, the result echoes the step. If it doesn't match, the result is `rejected` with the ids that are available, and no proposal is stored. The step link is shown in the proposal event but is not saved with the proposal.

### Approval

Approval is decided by `ApprovalPolicy` (`modules/approvals/approval.policy.ts`).

- A proposal needs the user's approval when it has more than **100** commands (`LARGE_BATCH_THRESHOLD`), or when it contains a destructive command.
- Destructive commands are `scene.delete_object`, and `geometry.create_primitive` with `replaceExisting: true`.
- Renaming, hiding and re-parenting are reversible, so they never need approval.
- `editor.apply_proposal` asks for approval when its proposal does. If the proposal cannot be found, approval is asked for anyway, so a person still sees the request.

## Editor commands

`editor.propose_commands` accepts a list of commands, at most **200** (`MAX_COMMANDS_PER_PROPOSAL`). Commands run in order, and a later command may use an object created or moved earlier in the same batch. The schema lives in `packages/editor-protocol/src/editor-command.schema.ts`, and the backend re-exports it from `apps/backend/src/shared/schemas/editor-command.schema.ts`.

| Command `type` | Purpose | Destructive |
| --- | --- | --- |
| `scene.create_object` | Adds an empty group or parent, optionally under `parentId`. | No |
| `scene.transform_object` | Moves, rotates or scales an existing object. | No |
| `scene.rename_object` | Changes the name of an existing object. | No |
| `scene.set_visibility` | Shows or hides an existing object. | No |
| `scene.set_parent` | Moves an existing object under another object, or to the top level (`parentId: null`). The object keeps its place in the world. It cannot go under itself or under anything below it. | No |
| `scene.delete_object` | Removes an existing object. Its children must be removed first. | Yes |
| `geometry.create_primitive` | Creates a box, sphere, cylinder or plane. With `replaceExisting: true` it replaces an existing object's shape. | Only with `replaceExisting: true` |

The desktop applies these commands in `apps/desktop/src/features/assistant/EditorScene.ts`. Any command added to the protocol must also be handled there.

## Scene objects

The editor snapshot lists objects with a `type`. The protocol allows `mesh`, `empty`, `collection`, `camera` and `light`. The desktop currently creates only `mesh` (primitives) and `empty` (groups). `visible` is included when the desktop reports it.

## Skills and the tools they name

Skills are in `skills/<id>/SKILL.md`. Their `tools:` list tells the model which tools a workflow uses. The list is informational: the agent still receives every registered tool.

| Skill | Tools named |
| --- | --- |
| `character-modeling` | `editor.get_context`, `modeling.generate_model_plan`, `editor.propose_commands`, `editor.apply_proposal`, `validation.check_scene` |
| `2.5d-character-design` | `editor.get_context`, `modeling.generate_model_plan`, `editor.propose_commands`, `editor.apply_proposal`, `validation.check_scene` |
| `mesh-editing` | `editor.get_context`, `editor.propose_commands`, `editor.apply_proposal`, `validation.check_scene` |

## Not exposed to the assistant

- **MCP tools.** `McpRegistry` (`modules/mcp/mcp.registry.ts`) is default-deny: a tool is usable only when its server is enabled and the tool is listed in `allowedTools`. No MCP tool is wired into the agent yet, so none appears in the inventory above.

## How a tool is wired

1. **Define.** Write the tool with `defineTool` in `apps/backend/src/modules/tools/<area>/<area>.tools.ts`. The name must match `namespace.snake_case` (`TOOL_NAME_PATTERN`).
2. **Register.** Add the tool to the list returned by the factory in `apps/backend/src/modules/tools/tools.module.ts`. Tools are listed as `editor`, `validation`, `skills` and then `modeling`. Plan steps are checked against the `editor`, `validation` and `skills` tools plus the plan tool itself.
3. **Check.** `ToolRegistry` rejects an invalid or duplicate name at startup.
4. **Expose.** `createModelingCoordinatorDefinition` passes every registered tool to the agent and lists the provider names in the instructions (`modeling-coordinator.instructions.ts`).
