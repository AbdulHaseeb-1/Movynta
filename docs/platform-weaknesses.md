# Platform weaknesses

This list records current limitations and should change as the platform changes.

## Highest priority

1. **Recovery has a bounded compatibility scope.** The current desktop prepares assistant edits in a separate scene, commits project history and proposal status together, then displays the candidate. Uncommitted candidates are discarded on disconnect. Saved edits with uncertain delivery are restored from durable history when the editor reconnects and checked when the assistant finishes. This fixes the live-before-save window for current saved-project editors. Legacy editor clients without prepare support retain the older retry behavior. Active model runs still fail rather than resume on backend restart. Offline recovery must wait for backend access; an unavailable backend is reported rather than treated as a successful save.
2. **Undo/redo is durable but replay-based.** Saved manual transforms, deletions, imports, geometry and assistant changes now share persistent history. Contiguous proposals from one assistant run undo together; multi-batch manual gestures share an action id. History survives reopen, imports retain source bytes, and a new edit abandons redo. Replaying large histories and reloading imported assets can be slow; missing or damaged assets prevent undo before its history commit. A visual history panel and checkpoints remain future work. Abandoned redo assets remain stored and count toward project capacity.
3. **Visual approval remains limited.** The assistant has a viewport capture tool, but approvals use text and command descriptions rather than an interactive before/after scene preview. Visual quality and model interpretation still need real-provider evaluation.

## Other current gaps

- Surface editing now supports 1–8 bevel segments on manifold concave/open meshes, editable modifier stacks, textures, multiple materials, skinning and morph targets. Remaining limits are overlapping bevel widths, unsupported non-manifold/degenerate topology, bounded refinement, and no automatic UV unwrap for newly generated bevel faces. Modifier editing is available to the assistant and through the manual Modifiers panel for the active mesh part, with saved undo/redo.
- General mesh creation, materials, rigging, animation and a complete export workflow remain limited or unavailable.
- Automated provider tests use mocked inference; actual model behavior and provider schema compatibility still need live evaluation.
- The backend runs separately from the desktop; credentials and authentication depend on Windows DPAPI. Active runs do not resume after restart.
- Large scenes and geometry have bounded limits; computational work is partly synchronous. The scene validator does not establish visual quality or detect every geometry defect.
- Approval is based on command type and batch size, rather than a complete assessment of the number, value or extent of affected objects.
