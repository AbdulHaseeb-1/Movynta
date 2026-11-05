import { Agent, OpenAIProvider, Runner, tool, type AgentInputItem, type Model, type ModelRequest, type ModelResponse } from "@openai/agents";
import OpenAI from "openai";
import { z } from "zod";
import { PICTURE_RESULTS_KEPT, moveToolPicturesToUserMessages, pictureBridgedModel } from "./chat-completions-pictures.js";

const PNG = "iVBORw0KGgo=";

function picture(name: string) {
  return { type: "input_image" as const, image: `data:image/png;base64,${name}` };
}

/** A tool result as the SDK stores it: the text of the result, then one part per picture. */
function result(callId: string, pictures: number): AgentInputItem {
  return {
    type: "function_call_result",
    name: "viewport__capture",
    callId,
    status: "completed",
    output: [
      { type: "input_text", text: `{"call":"${callId}"}` },
      ...Array.from({ length: pictures }, (_, index) => picture(`${callId}-${index}`)),
    ],
  };
}

const user = (text: string): AgentInputItem => ({ role: "user", content: text });
const assistant = (text: string): AgentInputItem => ({ role: "assistant", status: "completed", content: [{ type: "output_text", text }] });

function pictureCount(items: readonly AgentInputItem[]): number {
  return items.reduce((count, item) => {
    if (!("content" in item) || typeof item.content === "string") return count;
    return count + item.content.filter((part) => part.type === "input_image").length;
  }, 0);
}

describe("moveToolPicturesToUserMessages", () => {
  it("keeps the text of each result and sends its pictures in one user message after the batch", () => {
    const moved = moveToolPicturesToUserMessages([user("look"), result("c1", 2), result("c2", 1), assistant("done")]);

    expect(moved).toHaveLength(5);
    const [, first, second, pictureMessage, last] = moved;
    expect(first).toMatchObject({ type: "function_call_result", callId: "c1" });
    expect(JSON.stringify(first)).toContain("[picture 1 is in the next message]");
    expect(JSON.stringify(first)).toContain("[picture 2 is in the next message]");
    expect(JSON.stringify(first)).not.toContain("data:image");
    expect(JSON.stringify(second)).toContain("[picture 3 is in the next message]");
    expect(pictureMessage).toMatchObject({ role: "user" });
    expect(pictureCount([pictureMessage ?? user("")])).toBe(3);
    expect(last).toEqual(assistant("done"));
  });

  it("keeps the pictures of the most recent results only", () => {
    const input: AgentInputItem[] = [];
    for (let index = 1; index <= PICTURE_RESULTS_KEPT + 1; index += 1) {
      input.push(result(`c${index}`, 1), assistant(`step ${index}`));
    }
    const moved = moveToolPicturesToUserMessages(input);

    expect(pictureCount(moved)).toBe(PICTURE_RESULTS_KEPT);
    expect(JSON.stringify(moved[0])).toContain("a picture from an earlier result was removed");
    expect(JSON.stringify(moved[0])).not.toContain("data:image");
  });

  it("returns an input without pictures unchanged", () => {
    const input = [user("hello"), assistant("hi")];
    expect(moveToolPicturesToUserMessages(input)).toEqual(input);
  });

  it("does not change the input it was given", () => {
    const input = [result("c1", 1)];
    const before = JSON.stringify(input);
    moveToolPicturesToUserMessages(input);
    expect(JSON.stringify(input)).toBe(before);
  });
});

describe("pictureBridgedModel", () => {
  it("passes the rewritten input to both the plain and the streamed request", async () => {
    const seen: ModelRequest[] = [];
    const inner: Model = {
      getResponse: async (request) => {
        seen.push(request);
        return {} as ModelResponse;
      },
      getStreamedResponse: (request) => {
        seen.push(request);
        return (async function* () {})();
      },
    };
    const bridged = pictureBridgedModel(inner);
    const request = { input: [result("c1", 1)] } as unknown as ModelRequest;

    await bridged.getResponse(request);
    for await (const event of bridged.getStreamedResponse(request)) void event;

    expect(seen).toHaveLength(2);
    for (const sent of seen) expect(pictureCount(sent.input as AgentInputItem[])).toBe(1);
  });

  it("leaves a text-only request alone", async () => {
    const seen: ModelRequest[] = [];
    const inner: Model = {
      getResponse: async (request) => {
        seen.push(request);
        return {} as ModelResponse;
      },
      getStreamedResponse: () => (async function* () {})(),
    };
    const request = { input: "just text" } as unknown as ModelRequest;
    await pictureBridgedModel(inner).getResponse(request);
    expect(seen[0]).toBe(request);
  });
});

describe("pictures through a Chat Completions request", () => {
  it("sends a picture drawn by a tool as an image in the next user message, not in the tool message", async () => {
    const bodies: Record<string, unknown>[] = [];
    const fakeFetch: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      bodies.push(body);
      const calledTool = bodies.length === 1;
      const message = calledTool
        ? { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "look", arguments: "{}" } }] }
        : { role: "assistant", content: "The torso is round." };
      return new Response(
        JSON.stringify({
          id: "chatcmpl-1",
          object: "chat.completion",
          created: 1,
          model: "vision-model",
          choices: [{ index: 0, message, finish_reason: calledTool ? "tool_calls" : "stop" }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
        { headers: { "content-type": "application/json" } },
      );
    };
    const chat = await new OpenAIProvider({
      openAIClient: new OpenAI({ apiKey: "test-key", baseURL: "https://provider.example/v1", fetch: fakeFetch }),
      useResponses: false,
    }).getModel("vision-model");

    const look = tool({
      name: "look",
      description: "Look at the scene",
      parameters: z.object({}),
      execute: async () => [
        { type: "text", text: '{"views":1}' },
        { type: "image", image: { data: PNG, mediaType: "image/png" } },
      ],
    });
    const agent = new Agent({ name: "Viewer", model: pictureBridgedModel(chat), tools: [look] });
    const runner = new Runner({ tracingDisabled: true });

    const run = await runner.run(agent, "Look at the torso");

    expect(run.finalOutput).toBe("The torso is round.");
    expect(bodies).toHaveLength(2);
    const messages = bodies[1]?.["messages"] as { role: string; content: unknown }[];
    const toolIndex = messages.findIndex((message) => message.role === "tool");
    const toolContent = messages[toolIndex]?.content;
    expect(typeof toolContent).toBe("string");
    expect(toolContent as string).toContain('{"views":1}');
    expect(toolContent as string).not.toContain("base64");

    const pictureMessage = messages[toolIndex + 1];
    expect(pictureMessage?.role).toBe("user");
    expect(JSON.stringify(pictureMessage?.content)).toContain(`data:image/png;base64,${PNG}`);
    // Nothing was drawn before the tool ran, so the first request carries no picture.
    expect(JSON.stringify(bodies[0])).not.toContain("image_url");
  });
});
