# Assistant tools: reference

Every tool the modeling assistant can call, with what it needs, what it returns, a worked example and a visual drawn from that example. The examples are checked against the code by the backend test suite, so they stay accurate as the tools change.

This folder is generated from [`assistantTools.json`](../../apps/desktop/src/features/documentation/assistantTools/assistantTools.json), which is also what the desktop app shows under **Documentation → Assistant tools**. Change the JSON, then run `node docs/tools/generate.mjs`.

The backend test `apps/backend/src/modules/tools/tool-docs.spec.ts` runs the tools on the sample scene below and checks the examples against the code.

## Rules

1. Only editor.apply_proposal changes the scene. Every other tool reads, calculates, plans or stores.
2. A calculated batch is strict. Pass expectedRevision; if the scene changes first, the proposal fails and must be made again rather than moved onto the new scene.
3. A failed tool returns { "error": "...", "details": ... } to the model, so it can correct the call. The run keeps going.

## Tool types

| Type | What it does | Tools |
| --- | --- | --- |
| **Read** | These tools look at the scene or calculate a result. Nothing changes. | [`editor.get_context`](editor.get_context.md), [`editor.get_scene_summary`](editor.get_scene_summary.md), [`editor.inspect_mesh`](editor.inspect_mesh.md), [`editor.inspect_materials`](editor.inspect_materials.md), [`viewport.capture`](viewport.capture.md), [`validation.check_scene`](validation.check_scene.md), [`editor.measure`](editor.measure.md), [`editor.plan_placement`](editor.plan_placement.md), [`editor.plan_duplicates`](editor.plan_duplicates.md), [`modeling.generate_commands`](modeling.generate_commands.md), [`validation.check_brief`](validation.check_brief.md) |
| **Plan** | Records intent and the steps for a task. It changes nothing. | [`modeling.generate_model_plan`](modeling.generate_model_plan.md), [`modeling.assess_quality`](modeling.assess_quality.md), [`modeling.record_brief`](modeling.record_brief.md) |
| **Propose** | Stores a batch of changes for review. The scene is still unchanged. | [`editor.propose_commands`](editor.propose_commands.md), [`modeling.propose_generated`](modeling.propose_generated.md) |
| **Apply** | Changes the scene by applying a stored proposal. | [`editor.apply_proposal`](editor.apply_proposal.md) |
| **Skill** | Loads the workflow for a skill selected for this request. | [`skills.load_skill`](skills.load_skill.md) |

## The sample scene

Every example uses this scene, at revision 12, with `crate` selected.

| Object | id | Type | Parent | World bounds (min → max) |
| --- | --- | --- | --- | --- |
| Figure | `figure` | `empty` | none | `[-1.05,0.25,-0.3]` → `[1.05,1.8,0.3]` |
| Torso | `torso` | `mesh` | `figure` | `[-0.5,0.25,-0.3]` → `[0.5,1.75,0.3]` |
| Arm | `arm_left` | `mesh` | `figure` | `[-1.05,0.6,-0.15]` → `[-0.75,1.8,0.15]` |
| Arm | `arm_right` | `mesh` | `figure` | `[0.75,0.6,-0.15]` → `[1.05,1.8,0.15]` |
| Crate | `crate` | `mesh` | none | `[2.5,0,-0.5]` → `[3.5,1,0.5]` |
| Props | `props` | `empty` | none | no geometry |

## Conventions

| Term | Meaning |
| --- | --- |
| Identifiers | Match [A-Za-z0-9_-]{1,64}. Object and collection ids are separate. |
| Revisions | Nonnegative integers. Every read reports one, and calculated or proposed batches refer back to it. |
| Mesh paths | Name a mesh inside an imported object. Each step is a part name (Arm), a repeat (Arm#1 is the second one) or a child index. Use the paths the inspection returns. |
| Vectors | [x, y, z] in scene units. Positions are local to the parent unless a tool says world. |
| Matrices | Sixteen numbers, column-major. |
| Units | Scene units unless the project is calibrated; then measurementUnits says how many meters one scene unit is. |

## Tools

### Read

- [`editor.get_context`](editor.get_context.md): Reads the whole scene: every object with its parent and transform, the selection, the revision, and which features the editor supports.
- [`editor.get_scene_summary`](editor.get_scene_summary.md): Counts the objects by type and reports what is selected. A quick orientation before a larger read.
- [`editor.inspect_mesh`](editor.inspect_mesh.md): Reads the topology of one mesh: vertices, edges and faces, the faces that match a direction or position query, and its bounds.
- [`editor.inspect_materials`](editor.inspect_materials.md): Reads the material slots of one object: name, shader, colour, roughness, metalness, opacity, sidedness and texture channels, without reading topology.
- [`viewport.capture`](viewport.capture.md): Lets the assistant look at the scene. The editor draws it from one to six views and returns the pictures, with where each object sits in each one.
- [`validation.check_scene`](validation.check_scene.md): Checks the scene for structural problems and reports each with a severity: errors, warnings and information.
- [`editor.measure`](editor.measure.md): Measures the geometry the editor shows: size, distance, angle, edge length or the clearance between two objects, from evaluated geometry.
- [`editor.plan_placement`](editor.plan_placement.md): Works out the moves that align, space or snap objects, using the world bounds of evaluated geometry. It returns scene.move_object commands and changes nothing.
- [`editor.plan_duplicates`](editor.plan_duplicates.md): Plans independent copies of an object and everything under it. Each copy gets fresh ids and an offset. It returns one scene.duplicate_hierarchy command.
- [`modeling.generate_commands`](modeling.generate_commands.md): Runs a short JavaScript function in an isolated sandbox and returns the editor commands it calculates. Nothing is applied or proposed.
- [`validation.check_brief`](validation.check_brief.md): Measures the recorded brief against the current scene and reports each check as pass, fail or unresolved, with what was measured and what was needed.

### Plan

- [`modeling.generate_model_plan`](modeling.generate_model_plan.md): Writes down the goal and the ordered steps, and the tool each step will use. Recording a plan changes nothing in the scene.
- [`modeling.assess_quality`](modeling.assess_quality.md): Records the independent reviewer's verdict on the finished work. Only the reviewer has this tool; the assistant that builds cannot grade itself.
- [`modeling.record_brief`](modeling.record_brief.md): Writes down what the finished work must be as checks that code can pass or fail: sizes, placement, symmetry and counts. Recording a brief changes nothing in the scene.

### Propose

- [`editor.propose_commands`](editor.propose_commands.md): Stores a batch of scene commands for review. The batch is checked against the scene and kept waiting. Nothing changes until editor.apply_proposal runs.
- [`modeling.propose_generated`](modeling.propose_generated.md): Runs the same sandbox program as modeling.generate_commands, then stores the result as a proposal. The commands are not echoed back to the model.

### Apply

- [`editor.apply_proposal`](editor.apply_proposal.md): Applies a stored proposal to the editor. It is the only assistant tool that changes the scene. The commands join the project history, so the user can undo them.

### Skill

- [`skills.load_skill`](skills.load_skill.md): Loads the full workflow for a skill that was selected for this request, so only the instructions the task needs enter the prompt.
