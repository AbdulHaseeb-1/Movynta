export { inspectMesh, meshAtPath, meshPathOf, isEditableTarget } from "./meshInspection";
export { modifyGeometry, assertEditableMesh, type MeshModifier } from "./meshModifiers";
export { modifierStack, evaluateStack, evaluateBase, commitStack, copyModifierStack, disposeModifierStack, type ModifierStackState } from "./modifierStack";
export { extrudeRegion, type ExtrudeKind, type ExtrudeResult } from "./meshExtrude";
export { transformComponents, componentTransformSelection } from "./meshComponentTransform";
export { mergeVertices } from "./meshMerge";
export { dissolveEdges } from "./meshDissolve";
export { slideEdges } from "./meshSlide";
export { loopCut } from "./meshLoopCut";
