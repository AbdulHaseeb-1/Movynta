export { EXAMPLE_IDS, type ExampleId } from "./exampleIds";
export { ToolExample } from "./ToolExample";
export { ExampleFrame, type ExampleFrameProps, type ExampleHint } from "./ExampleFrame";
// The example components themselves are loaded on demand by `ToolExample`; importing them here would bundle
// them, and the WebGL viewport, with every page.
export {
  boxSelect,
  clickSelect,
  itemsInRect,
  operationText,
  rectFrom,
  type Modifiers,
  type PlaygroundItem,
  type Rect,
} from "./selectionPlayground";
export {
  INITIAL_PLAYGROUND,
  INITIAL_SHAPE,
  numericError,
  previewShape,
  transformReducer,
  transformStatus,
  type PlaygroundAction,
  type PlaygroundAxis,
  type PlaygroundShape,
  type Point,
  type TransformOperation,
  type TransformPlayground,
  type TransformSession,
} from "./transformPlayground";
