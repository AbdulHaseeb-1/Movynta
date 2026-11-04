export { inspectMesh, meshAtPath, isEditableTarget } from "./meshInspection";
export { modifyGeometry, assertEditableMesh, type MeshModifier } from "./meshModifiers";
export { modifierStack, evaluateStack, evaluateBase, commitStack, copyModifierStack, disposeModifierStack, type ModifierStackState } from "./modifierStack";
export { extrudeRegion, type ExtrudeKind, type ExtrudeResult } from "./meshExtrude";
