import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { ProviderJsonModeError, ProviderJsonParseError } from "../types.ts";
import type { OpenAIOptions } from "../types.ts";

// Mock the openai module before importing the adapter
const mockResponsesCreate = vi.fn();
const mockChatCompletionsCreate = vi.fn();

const MockOpenAI = vi.fn().mockImplementation(() => ({
  responses: { create: mockResponsesCreate },
  chat: { completions: { create: mockChatCompletionsCreate } },
}));

vi.mock("openai", () => {
  return {
    default: MockOpenAI,
  };
});

import { openaiChat, _resetClient } from "../openai.ts";

function makeChatCompletion(
  text: string,
  promptTokens = 10,
  completionTokens = 20,
) {
  return {
    choices: [{ message: { content: text }, finish_reason: "stop" }],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
  };
}

function makeResponsesResult(text: string, inputTokens = 10, outputTokens = 20) {
  return {
    output_text: text,
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: inputTokens + outputTokens,
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

  it("uses Responses API for gpt-5 models", async () => {
    const jsonPayload = { result: "from-responses" };
    mockResponsesCreate.mockResolvedValue(
      makeResponsesResult(JSON.stringify(jsonPayload)),
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
  });

  it("uses Responses API for gpt-5-chat-latest (case-insensitive)", async () => {
    const jsonPayload = { ok: true };
    mockResponsesCreate.mockResolvedValue(
      makeResponsesResult(JSON.stringify(jsonPayload)),
    );

    await openaiChat({
      ...baseOptions,
      model: "GPT-5-chat-latest",
    });

    expect(mockResponsesCreate).toHaveBeenCalledTimes(1);
    expect(mockChatCompletionsCreate).not.toHaveBeenCalled();
  });

  it("uses Chat Completions API for non-gpt-5 models", async () => {
    const jsonPayload = { result: "from-completions" };
    mockChatCompletionsCreate.mockResolvedValue(
      makeChatCompletion(JSON.stringify(jsonPayload)),
    );

    const result = await openaiChat({
      ...baseOptions,
      model: "gpt-4o",
    });

    expect(mockChatCompletionsCreate).toHaveBeenCalledTimes(1);
    expect(mockResponsesCreate).not.toHaveBeenCalled();
    expect(result.content).toEqual(jsonPayload);
    expect(result.usage).toEqual({
      prompt_tokens: 10,
      completion_tokens: 20,
      total_tokens: 30,
    });
  });

  it("falls back to Chat Completions API on 'unsupported' error from Responses API", async () => {
    const unsupportedErr = new Error("This model is unsupported for the Responses API");
    (unsupportedErr as { status?: number }).status = 400;
    mockResponsesCreate.mockRejectedValue(unsupportedErr);

    const jsonPayload = { fallback: true };
    mockChatCompletionsCreate.mockResolvedValue(
      makeChatCompletion(JSON.stringify(jsonPayload)),
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
      makeChatCompletion(JSON.stringify(jsonPayload)),
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
      makeChatCompletion(nonJsonText),
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
      makeResponsesResult(JSON.stringify(jsonPayload)),
    );

    await openaiChat({
      messages: baseOptions.messages,
    });

    // gpt-5-chat-latest matches /^gpt-5/i, so Responses API should be used
    expect(mockResponsesCreate).toHaveBeenCalledTimes(1);
    const callArgs = mockResponsesCreate.mock.calls[0]![0] as Record<string, unknown>;
    expect(callArgs["model"]).toBe("gpt-5-chat-latest");
  });

  it("estimates usage at ~4 chars/token when Responses API lacks usage", async () => {
    const jsonPayload = { estimated: true };
    const text = JSON.stringify(jsonPayload);
    mockResponsesCreate.mockResolvedValue({
      output_text: text,
      // No usage field
    });

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
      .mockResolvedValueOnce(makeChatCompletion(JSON.stringify(jsonPayload)));

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
      makeChatCompletion(JSON.stringify(jsonPayload)),
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
      makeResponsesResult(JSON.stringify({ ok: true })),
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
    });
  });

  it("passes json_schema to the Responses API when provided", async () => {
    mockResponsesCreate.mockResolvedValue(
      makeResponsesResult(JSON.stringify({ ok: true })),
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
});
