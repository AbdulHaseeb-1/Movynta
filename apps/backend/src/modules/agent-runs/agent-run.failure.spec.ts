import { classifyFailure, describeError, redactSecrets } from "./agent-run.failure.js";

class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly error?: { message: string },
  ) {
    super(message);
    this.name = "APIError";
  }
}

describe("classifyFailure", () => {
  it("explains provider errors by status", () => {
    expect(classifyFailure(new ApiError("x", 401), false).code).toBe("provider_auth");
    expect(classifyFailure(new ApiError("x", 404), false).code).toBe("provider_model_not_found");
    expect(classifyFailure(new ApiError("x", 429), false).code).toBe("provider_rate_limited");
    expect(classifyFailure(new ApiError("x", 503), false).code).toBe("provider_unavailable");
  });

  it("passes on the provider's reason for bad requests", () => {
    const failure = classifyFailure(
      new ApiError("400", 400, { message: "Unsupported value: 'minimal' is not supported with this model." }),
      false,
    );
    expect(failure.code).toBe("provider_bad_request");
    expect(failure.message).toContain("'minimal' is not supported");
  });

  it("finds the status on a wrapped cause", () => {
    const wrapped = new Error("run failed", { cause: new ApiError("x", 429) });
    expect(classifyFailure(wrapped, false).code).toBe("provider_rate_limited");
  });

  it("recognizes network failures and timeouts", () => {
    const refused = Object.assign(new Error("fetch failed"), { cause: Object.assign(new Error("connect"), { code: "ECONNREFUSED" }) });
    expect(classifyFailure(refused, false).code).toBe("provider_unreachable");
    expect(classifyFailure(new Error("anything"), true).code).toBe("run_timeout");
  });

  it("explains an empty length stop from Chat Completions", () => {
    const error = new Error("Chat Completions response terminated with finish_reason='length' but produced no assistant text, tool call, or refusal.");
    const failure = classifyFailure(error, false);
    expect(failure.code).toBe("model_output_truncated");
    expect(failure.message).toContain("output limit");
  });

  it("falls back to a generic failure", () => {
    expect(classifyFailure(new Error("boom"), false).code).toBe("run_failed");
  });
});

describe("describeError", () => {
  it("lists the chain with status and provider message, without secrets", () => {
    const error = new Error("outer", {
      cause: new ApiError("Incorrect API key provided: sk-abc123456789xyz", 401, {
        message: "Incorrect API key provided: sk-abc123456789xyz",
      }),
    });
    const text = describeError(error);
    expect(text).toContain("status=401");
    expect(text).toContain("APIError");
    expect(text).not.toContain("sk-abc123456789xyz");
  });
});

describe("redactSecrets", () => {
  it("masks keys and bearer tokens", () => {
    expect(redactSecrets("key sk-abcdefghijk and Bearer abcdefghijklmnop")).toBe("key sk-… and Bearer …");
  });
});
