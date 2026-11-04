import { chatCompletionsFetch, liftChatCompletionReasoning, normalizeChatCompletionBody } from "./chat-completions-fetch.js";

describe("liftChatCompletionReasoning", () => {
  it("copies reasoning_content and reasoning_details onto the string the SDK reads", () => {
    const delta: Record<string, unknown> = {
      content: null,
      reasoning_content: "check the overlap",
      reasoning_details: [{ type: "reasoning.text", text: " then cut" }],
    };
    liftChatCompletionReasoning(delta);
    expect(delta["reasoning"]).toBe("check the overlap then cut");
  });

  it("keeps a reasoning string that is already present", () => {
    const delta: Record<string, unknown> = { reasoning: "kept", reasoning_content: "ignored" };
    liftChatCompletionReasoning(delta);
    expect(delta["reasoning"]).toBe("kept");
  });

  it("turns an object reasoning payload into text", () => {
    const delta: Record<string, unknown> = { reasoning: { text: "from the object" } };
    liftChatCompletionReasoning(delta);
    expect(delta["reasoning"]).toBe("from the object");
  });
});

describe("normalizeChatCompletionBody", () => {
  it("rewrites both streamed deltas and final messages", () => {
    const body = {
      choices: [
        { delta: { reasoning_content: "stream" } },
        { message: { reasoning_details: [{ summary: "final" }] } },
      ],
    };
    normalizeChatCompletionBody(body);
    expect(body.choices[0]?.delta).toMatchObject({ reasoning: "stream" });
    expect(body.choices[1]?.message).toMatchObject({ reasoning: "final" });
  });
});

describe("chatCompletionsFetch", () => {
  it("rewrites an event stream and leaves error bodies untouched", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"reasoning_content":"think"}}]}\n\n'));
        controller.enqueue(encoder.encode("data: [DONE]\n"));
        controller.close();
      },
    });
    const fetchImpl = chatCompletionsFetch(async () => new Response(stream, {
      status: 200,
      headers: { "content-type": "text/event-stream", "content-length": "12" },
    }));
    const response = await fetchImpl("https://provider.example/v1/chat/completions");
    const text = await response.text();
    expect(response.headers.get("content-length")).toBeNull();
    expect(text).toContain('"reasoning":"think"');
    expect(text).toContain("data: [DONE]");

    const failing = chatCompletionsFetch(async () => new Response("nope", { status: 400, headers: { "content-type": "application/json" } }));
    const error = await failing("https://provider.example/v1/chat/completions");
    expect(await error.text()).toBe("nope");
  });

  it("rewrites a JSON completion", async () => {
    const fetchImpl = chatCompletionsFetch(async () => new Response(
      JSON.stringify({ choices: [{ message: { reasoning_content: "done" } }] }),
      { status: 200, headers: { "content-type": "application/json" } },
    ));
    const body: unknown = await (await fetchImpl("https://provider.example/v1/chat/completions")).json();
    expect(body).toMatchObject({ choices: [{ message: { reasoning: "done" } }] });
  });
});
