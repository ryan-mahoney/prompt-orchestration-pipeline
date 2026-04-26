import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { ProviderJsonModeError, ProviderJsonParseError } from "../types.ts";
import type { OpenAIOptions } from "../types.ts";

// Use var to avoid TDZ — vi.mock is hoisted above let/const declarations
// eslint-disable-next-line no-var
var mockResponsesCreate: ReturnType<typeof vi.fn>;
// eslint-disable-next-line no-var
var mockChatCompletionsCreate: ReturnType<typeof vi.fn>;
// eslint-disable-next-line no-var
var MockOpenAI: ReturnType<typeof vi.fn>;

vi.mock("openai", () => {
  mockResponsesCreate = vi.fn();
  mockChatCompletionsCreate = vi.fn();
  MockOpenAI = vi.fn().mockImplementation(() => ({
    responses: { create: mockResponsesCreate },
    chat: { completions: { create: mockChatCompletionsCreate } },
  }));
  return { default: MockOpenAI };
});

import { openaiChat, _resetClient } from "../openai.ts";

/**
 * Creates an async iterable that yields streaming chat completion chunks.
 */
function makeStreamingChatCompletion(
  textChunks: string[],
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number },
): AsyncIterable<Record<string, unknown>> {
  const events: Record<string, unknown>[] = [];

  for (const chunk of textChunks) {
    events.push({
      choices: [{ delta: { content: chunk }, finish_reason: null }],
    });
  }
  // Final chunk with finish_reason and optional usage
  events.push({
    choices: [{ delta: {}, finish_reason: "stop" }],
    ...(usage ? { usage } : {}),
  });

  return {
    async *[Symbol.asyncIterator]() {
      for (const event of events) {
        yield event;
      }
    },
  };
}

/**
 * Creates an async iterable that yields streaming Responses API events.
 */
function makeStreamingResponsesResult(
  textChunks: string[],
  inputTokens = 10,
  outputTokens = 20,
): AsyncIterable<Record<string, unknown>> {
  const events: Record<string, unknown>[] = [];

  for (const chunk of textChunks) {
    events.push({
      type: "response.output_text.delta",
      delta: chunk,
    });
  }

  events.push({
    type: "response.completed",
    response: {
      usage: {
        input_tokens: inputTokens,
        output_tokens: outputTokens,
      },
    },
  });

  return {
    async *[Symbol.asyncIterator]() {
      for (const event of events) {
        yield event;
      }
    },
  };
}

const baseOptions: OpenAIOptions = {
  messages: [
    { role: "system", content: "You are helpful." },
    { role: "user", content: "Return JSON." },
  ],
  responseFormat: "json_object",
};

describe("openaiChat", () => {
  beforeEach(() => {
    _resetClient();
    mockResponsesCreate.mockReset();
    mockChatCompletionsCreate.mockReset();
    process.env["OPENAI_API_KEY"] = "test-key";
  });

  afterEach(() => {
    delete process.env["OPENAI_API_KEY"];
    delete process.env["OPENAI_BASE_URL"];
    delete process.env["OPENAI_ORGANIZATION"];
  });

  it("uses streaming Responses API for gpt-5 models", async () => {
    const jsonPayload = { result: "from-responses" };
    mockResponsesCreate.mockResolvedValue(
      makeStreamingResponsesResult([JSON.stringify(jsonPayload)]),
    );

    const result = await openaiChat({
      ...baseOptions,
      model: "gpt-5",
    });

    expect(mockResponsesCreate).toHaveBeenCalledTimes(1);
    expect(mockChatCompletionsCreate).not.toHaveBeenCalled();
    expect(result.content).toEqual(jsonPayload);
    expect(result.text).toBe(JSON.stringify(jsonPayload));
    expect(result.usage).toBeDefined();

    // Verify stream: true is passed
    const callArgs = mockResponsesCreate.mock.calls[0]![0] as Record<string, unknown>;
    expect(callArgs["stream"]).toBe(true);
  });

  it("uses streaming Responses API for gpt-5-chat-latest (case-insensitive)", async () => {
    const jsonPayload = { ok: true };
    mockResponsesCreate.mockResolvedValue(
      makeStreamingResponsesResult([JSON.stringify(jsonPayload)]),
    );

    await openaiChat({
      ...baseOptions,
      model: "GPT-5-chat-latest",
    });

    expect(mockResponsesCreate).toHaveBeenCalledTimes(1);
    expect(mockChatCompletionsCreate).not.toHaveBeenCalled();
  });

  it("uses streaming Chat Completions API for non-gpt-5 models", async () => {
    const jsonPayload = { result: "from-completions" };
    const usage = { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 };
    mockChatCompletionsCreate.mockResolvedValue(
      makeStreamingChatCompletion([JSON.stringify(jsonPayload)], usage),
    );

    const result = await openaiChat({
      ...baseOptions,
      model: "gpt-4o",
    });

    expect(mockChatCompletionsCreate).toHaveBeenCalledTimes(1);
    expect(mockResponsesCreate).not.toHaveBeenCalled();
    expect(result.content).toEqual(jsonPayload);
    expect(result.usage).toEqual(usage);

    // Verify stream: true and stream_options are passed
    const callArgs = mockChatCompletionsCreate.mock.calls[0]![0] as Record<string, unknown>;
    expect(callArgs["stream"]).toBe(true);
    expect(callArgs["stream_options"]).toEqual({ include_usage: true });
  });

  it("falls back to streaming Chat Completions API on 'unsupported' error from Responses API", async () => {
    const unsupportedErr = new Error("This model is unsupported for the Responses API");
    (unsupportedErr as { status?: number }).status = 400;
    mockResponsesCreate.mockRejectedValue(unsupportedErr);

    const jsonPayload = { fallback: true };
    mockChatCompletionsCreate.mockResolvedValue(
      makeStreamingChatCompletion([JSON.stringify(jsonPayload)]),
    );

    const result = await openaiChat({
      ...baseOptions,
      model: "gpt-5-preview",
    });

    expect(mockResponsesCreate).toHaveBeenCalledTimes(1);
    expect(mockChatCompletionsCreate).toHaveBeenCalledTimes(1);
    expect(result.content).toEqual(jsonPayload);
  });

  it("does not include max_tokens in the request body", async () => {
    const jsonPayload = { ok: true };
    mockChatCompletionsCreate.mockResolvedValue(
      makeStreamingChatCompletion([JSON.stringify(jsonPayload)]),
    );

    await openaiChat({
      ...baseOptions,
      model: "gpt-4o",
      max_tokens: 9999,
      maxTokens: 2048,
    });

    // Verify that the Chat Completions call used maxTokens (2048), not max_tokens (9999)
    const callArgs = mockChatCompletionsCreate.mock.calls[0]![0] as Record<string, unknown>;
    expect(callArgs["max_tokens"]).toBe(2048);
  });

  it("does not retry on 401 authentication error", async () => {
    const authErr = new Error("Incorrect API key provided");
    (authErr as { status?: number }).status = 401;
    mockChatCompletionsCreate.mockRejectedValue(authErr);

    await expect(
      openaiChat({
        ...baseOptions,
        model: "gpt-4o",
        maxRetries: 3,
      }),
    ).rejects.toThrow(/Incorrect API key/);

    // Should only be called once — no retries
    expect(mockChatCompletionsCreate).toHaveBeenCalledTimes(1);
  });

  it("throws ProviderJsonModeError when responseFormat is invalid", async () => {
    await expect(
      openaiChat({
        ...baseOptions,
        responseFormat: "text",
      }),
    ).rejects.toThrow(ProviderJsonModeError);
  });

  it("throws ProviderJsonParseError for non-JSON text in JSON mode", async () => {
    const nonJsonText = "This is plain text, not JSON at all.";
    mockChatCompletionsCreate.mockResolvedValue(
      makeStreamingChatCompletion([nonJsonText]),
    );

    try {
      await openaiChat({
        ...baseOptions,
        model: "gpt-4o",
      });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderJsonParseError);
      const parseErr = err as ProviderJsonParseError;
      expect(parseErr.provider).toBe("openai");
      expect(parseErr.model).toBe("gpt-4o");
      expect(parseErr.sample).toBeTruthy();
    }
  });

  it("defaults to gpt-5-chat-latest model and json_object format", async () => {
    const jsonPayload = { default: true };
    mockResponsesCreate.mockResolvedValue(
      makeStreamingResponsesResult([JSON.stringify(jsonPayload)]),
    );

    await openaiChat({
      messages: baseOptions.messages,
    });

    // gpt-5-chat-latest matches /^gpt-5/i, so Responses API should be used
    expect(mockResponsesCreate).toHaveBeenCalledTimes(1);
    const callArgs = mockResponsesCreate.mock.calls[0]![0] as Record<string, unknown>;
    expect(callArgs["model"]).toBe("gpt-5-chat-latest");
  });

  it("estimates usage at ~4 chars/token when Responses API stream lacks usage", async () => {
    const jsonPayload = { estimated: true };
    const text = JSON.stringify(jsonPayload);

    // Streaming response that completes without a response.completed event carrying usage
    const noUsageStream: AsyncIterable<Record<string, unknown>> = {
      async *[Symbol.asyncIterator]() {
        yield { type: "response.output_text.delta", delta: text };
        // No response.completed event with usage
      },
    };
    mockResponsesCreate.mockResolvedValue(noUsageStream);

    const result = await openaiChat({
      ...baseOptions,
      model: "gpt-5",
    });

    // Estimation: ~4 chars/token
    expect(result.usage).toBeDefined();
    expect(result.usage!.prompt_tokens).toBeGreaterThan(0);
    expect(result.usage!.completion_tokens).toBeGreaterThan(0);
  });

  it("retries on retryable errors and eventually succeeds", async () => {
    const retryableErr = new Error("Server error");
    (retryableErr as { status?: number }).status = 500;

    const jsonPayload = { retried: true };
    mockChatCompletionsCreate
      .mockRejectedValueOnce(retryableErr)
      .mockResolvedValueOnce(
        makeStreamingChatCompletion([JSON.stringify(jsonPayload)]),
      );

    const result = await openaiChat({
      ...baseOptions,
      model: "gpt-4o",
      maxRetries: 3,
    });

    expect(mockChatCompletionsCreate).toHaveBeenCalledTimes(2);
    expect(result.content).toEqual(jsonPayload);
  });

  it("passes seed, frequencyPenalty, presencePenalty to Chat Completions API", async () => {
    const jsonPayload = { ok: true };
    mockChatCompletionsCreate.mockResolvedValue(
      makeStreamingChatCompletion([JSON.stringify(jsonPayload)]),
    );

    await openaiChat({
      ...baseOptions,
      model: "gpt-4o",
      seed: 42,
      frequencyPenalty: 0.5,
      presencePenalty: 0.3,
    });

    const callArgs = mockChatCompletionsCreate.mock.calls[0]![0] as Record<string, unknown>;
    expect(callArgs["seed"]).toBe(42);
    expect(callArgs["frequency_penalty"]).toBe(0.5);
    expect(callArgs["presence_penalty"]).toBe(0.3);
  });

  it("configures the OpenAI client from environment variables", async () => {
    process.env["OPENAI_BASE_URL"] = "https://example.test/v1";
    process.env["OPENAI_ORGANIZATION"] = "org_test";
    mockResponsesCreate.mockResolvedValue(
      makeStreamingResponsesResult([JSON.stringify({ ok: true })]),
    );

    await openaiChat({
      ...baseOptions,
      model: "gpt-5",
    });

    expect(MockOpenAI).toHaveBeenCalledWith({
      apiKey: "test-key",
      organization: "org_test",
      baseURL: "https://example.test/v1",
      maxRetries: 0,
      timeout: 3_600_000,
    });
  });

  it("constructs the client with custom requestTimeoutMs", async () => {
    mockChatCompletionsCreate.mockResolvedValue(
      makeStreamingChatCompletion([JSON.stringify({ ok: true })]),
    );

    await openaiChat({
      ...baseOptions,
      model: "gpt-4o",
      requestTimeoutMs: 30_000,
    });

    expect(MockOpenAI).toHaveBeenCalledWith(
      expect.objectContaining({ timeout: 30_000 }),
    );
  });

  it("creates separate client instances for different timeout values", async () => {
    mockChatCompletionsCreate.mockResolvedValue(
      makeStreamingChatCompletion([JSON.stringify({ ok: true })]),
    );

    await openaiChat({ ...baseOptions, model: "gpt-4o", requestTimeoutMs: 10_000 });
    await openaiChat({ ...baseOptions, model: "gpt-4o", requestTimeoutMs: 60_000 });

    // Two distinct timeout values should produce two client constructions
    const timeouts = MockOpenAI.mock.calls.map(
      (call: unknown[]) => (call[0] as { timeout: number }).timeout,
    );
    expect(timeouts).toContain(10_000);
    expect(timeouts).toContain(60_000);
  });

  it("passes json_schema to the streaming Responses API when provided", async () => {
    mockResponsesCreate.mockResolvedValue(
      makeStreamingResponsesResult([JSON.stringify({ ok: true })]),
    );

    await openaiChat({
      ...baseOptions,
      model: "gpt-5",
      responseFormat: {
        json_schema: {
          type: "object",
          properties: { ok: { type: "boolean" } },
        },
      },
    });

    const callArgs = mockResponsesCreate.mock.calls[0]![0] as Record<string, unknown>;
    expect(callArgs["text"]).toEqual({
      format: {
        type: "json_schema",
        name: "Response",
        schema: {
          type: "object",
          properties: { ok: { type: "boolean" } },
        },
      },
    });
  });

  describe("streaming accumulation", () => {
    it("accumulates text across multiple streaming chunks for Chat Completions", async () => {
      const usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 };
      mockChatCompletionsCreate.mockResolvedValue(
        makeStreamingChatCompletion(['{"he', 'llo":"world"}'], usage),
      );

      const result = await openaiChat({
        ...baseOptions,
        model: "gpt-4o",
      });

      expect(result.content).toEqual({ hello: "world" });
      expect(result.usage).toEqual(usage);
    });

    it("accumulates text across multiple streaming chunks for Responses API", async () => {
      mockResponsesCreate.mockResolvedValue(
        makeStreamingResponsesResult(['{"he', 'llo":"world"}'], 10, 5),
      );

      const result = await openaiChat({
        ...baseOptions,
        model: "gpt-5",
      });

      expect(result.content).toEqual({ hello: "world" });
      expect(result.usage).toEqual({
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
      });
    });

    it("defaults usage to zeros when Chat Completions stream has no usage", async () => {
      mockChatCompletionsCreate.mockResolvedValue(
        makeStreamingChatCompletion([JSON.stringify({ ok: true })]),
      );

      const result = await openaiChat({
        ...baseOptions,
        model: "gpt-4o",
      });

      expect(result.usage).toEqual({
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
      });
    });
  });
});
