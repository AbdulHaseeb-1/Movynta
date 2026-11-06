import type { AgentInputItem, Model, ModelRequest, UserMessageItem } from "@openai/agents";

/**
 * Tool results whose pictures are sent with a request. Older results keep their text and lose their pictures, so
 * a long run does not resend every picture it has ever drawn.
 */
export const PICTURE_RESULTS_KEPT = 4;

type ToolResultItem = Extract<AgentInputItem, { type: "function_call_result" }>;
type ToolOutputPart = Extract<ToolResultItem["output"], readonly unknown[]>[number];
type PictureOutputPart = Extract<ToolOutputPart, { type: "input_image" }>;

const REMOVED_PICTURE = "[a picture from an earlier result was removed to save context; capture the view again if you need it]";
const UNSENDABLE_PICTURE = "[a picture is not shown: only picture URLs or data URLs can be sent through this connection]";

function isToolResult(item: AgentInputItem): item is ToolResultItem {
  return "type" in item && item.type === "function_call_result";
}

function isPicture(part: ToolOutputPart): part is PictureOutputPart {
  return part.type === "input_image";
}

function resultHasPictures(item: ToolResultItem): boolean {
  return Array.isArray(item.output) && item.output.some(isPicture);
}

/**
 * Chat Completions accepts only text in a tool message, so a picture drawn by a tool would be dropped there.
 * This keeps the text of the result, marks where each picture went, and returns the pictures so the caller
 * can send them in the user message that follows the batch of results.
 */
function moveResultPictures(item: ToolResultItem, keep: boolean, carried: PictureOutputPart[]): ToolResultItem {
  if (!Array.isArray(item.output)) return item;
  const output = item.output.map((part): ToolOutputPart => {
    if (!isPicture(part)) return part;
    if (!keep) return { type: "input_text", text: REMOVED_PICTURE };
    if (typeof part.image !== "string") return { type: "input_text", text: UNSENDABLE_PICTURE };
    const label = carried.length + 1;
    carried.push(part);
    return { type: "input_text", text: `[picture ${label} is in the next message]` };
  });
  return { ...item, output };
}

function pictureMessage(pictures: readonly PictureOutputPart[]): UserMessageItem {
  return {
    role: "user",
    content: [{ type: "input_text", text: "Pictures from the tool results above, in the order of their placeholders:" }, ...pictures],
  };
}

/**
 * Rewrites a request's input so that pictures drawn by tools reach a Chat Completions model. Each batch of tool
 * results is followed by one user message that carries the pictures of that batch. Only the most recent results
 * keep their pictures. The input is not changed; a new array is returned.
 */
export function moveToolPicturesToUserMessages(
  input: readonly AgentInputItem[],
  keepResults = PICTURE_RESULTS_KEPT,
): AgentInputItem[] {
  const pictureResults = input.flatMap((item, index) => (isToolResult(item) && resultHasPictures(item) ? [index] : []));
  const kept = new Set(pictureResults.slice(Math.max(0, pictureResults.length - keepResults)));

  const output: AgentInputItem[] = [];
  let carried: PictureOutputPart[] = [];
  // A batch of tool results must stay together, so the pictures go after its last result, before the next item.
  const flush = (): void => {
    if (carried.length === 0) return;
    output.push(pictureMessage(carried));
    carried = [];
  };
  input.forEach((item, index) => {
    if (!isToolResult(item)) {
      flush();
      output.push(item);
      return;
    }
    output.push(resultHasPictures(item) ? moveResultPictures(item, kept.has(index), carried) : item);
  });
  flush();
  return output;
}

/** Wraps a model so that its requests carry tool pictures in user messages. Responses and streams both use it. */
export function pictureBridgedModel(model: Model): Model {
  const adapt = (request: ModelRequest): ModelRequest =>
    typeof request.input === "string" ? request : { ...request, input: moveToolPicturesToUserMessages(request.input) };
  return {
    getResponse: (request) => model.getResponse(adapt(request)),
    getStreamedResponse: (request) => model.getStreamedResponse(adapt(request)),
    getRetryAdvice: (args) => model.getRetryAdvice?.(args),
  };
}
