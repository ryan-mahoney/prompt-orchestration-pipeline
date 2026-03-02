import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { anthropicChat } from "../anthropic.ts";
import { ProviderJsonModeError, ProviderJsonParseError } from "../types.ts";
import type { AnthropicOptions } from "../types.ts";
import type { Mock } from "vitest";

function makeAnthropicResponse(
  text: string,
  inputTokens = 10,
  outputTokens = 20,
) {
  return {
    content: [{ type: "text", text }],
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
  };
}

function mockFetchResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(JSON.stringify(body)),
  } as unknown as Response;
}

const baseOptions: AnthropicOptions = {
  messages: [
    { role: "system", content: "You are helpful." },
    { role: "user", content: "Return JSON." },
  ],
  responseFormat: "json",
};

describe("anthropicChat", () => {
  let originalFetch: typeof globalThis.fetch;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fetchMock: Mock<(...args: any[]) => any>;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    process.env["ANTHROPIC_API_KEY"] = "test-key";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env["ANTHROPIC_API_KEY"];
  });

  it("returns parsed JSON content, correct usage, and text for a valid response", async () => {
    const jsonPayload = { result: "success", count: 42 };
    fetchMock.mockResolvedValue(
      mockFetchResponse(makeAnthropicResponse(JSON.stringify(jsonPayload), 15, 25)),
    );

    const result = await anthropicChat(baseOptions);

    expect(result.content).toEqual(jsonPayload);
    expect(result.text).toBe(JSON.stringify(jsonPayload));
    expect(result.usage).toEqual({
      prompt_tokens: 15,
      completion_tokens: 25,
      total_tokens: 40,
    });
    expect(result.raw).toBeDefined();
  });

  it("throws immediately on 401 without retrying", async () => {
    fetchMock.mockResolvedValue(
      mockFetchResponse({ error: { message: "Unauthorized" } }, 401),
    );

    await expect(
      anthropicChat({ ...baseOptions, maxRetries: 3 }),
    ).rejects.toMatchObject({ status: 401, message: "Unauthorized" });

    // fetch should be called exactly once — no retries
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries on 429 then succeeds on 200", async () => {
    const jsonPayload = { retried: true };
    fetchMock
      .mockResolvedValueOnce(
        mockFetchResponse({ error: { message: "Rate limited" } }, 429),
      )
      .mockResolvedValueOnce(
        mockFetchResponse(makeAnthropicResponse(JSON.stringify(jsonPayload))),
      );

    const result = await anthropicChat({
      ...baseOptions,
      maxRetries: 3,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.content).toEqual(jsonPayload);
  });

  it("throws ProviderJsonModeError when responseFormat is invalid", async () => {
    await expect(
      anthropicChat({
        ...baseOptions,
        responseFormat: "text",
      }),
    ).rejects.toThrow(ProviderJsonModeError);
  });

  it("defaults to json responseFormat when responseFormat is omitted", async () => {
    const jsonPayload = { defaultFormat: true };
    fetchMock.mockResolvedValue(
      mockFetchResponse(makeAnthropicResponse(JSON.stringify(jsonPayload))),
    );

    // responseFormat defaults to "json" — should not throw
    const result = await anthropicChat({
      messages: baseOptions.messages,
    });
    expect(result.content).toEqual(jsonPayload);
  });

  it("throws ProviderJsonParseError for non-JSON text in JSON mode", async () => {
    const nonJsonText = "This is plain text, not JSON at all.";
    fetchMock.mockResolvedValue(
      mockFetchResponse(makeAnthropicResponse(nonJsonText)),
    );

    try {
      await anthropicChat(baseOptions);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderJsonParseError);
      const parseErr = err as ProviderJsonParseError;
      expect(parseErr.provider).toBe("anthropic");
      expect(parseErr.model).toBe("claude-3-sonnet");
      expect(parseErr.sample).toBeTruthy();
    }
  });

  it("sends correct headers including anthropic-version and x-api-key", async () => {
    const jsonPayload = { ok: true };
    fetchMock.mockResolvedValue(
      mockFetchResponse(makeAnthropicResponse(JSON.stringify(jsonPayload))),
    );

    await anthropicChat(baseOptions);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    const headers = init.headers as Record<string, string>;
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    expect(headers["x-api-key"]).toBe("test-key");
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("constructs the request body with system and messages in conversation order", async () => {
    const jsonPayload = { ok: true };
    fetchMock.mockResolvedValue(
      mockFetchResponse(makeAnthropicResponse(JSON.stringify(jsonPayload))),
    );

    await anthropicChat({
      messages: [
        { role: "system", content: "Be concise." },
        { role: "user", content: "Question 1" },
        { role: "assistant", content: "Answer 1" },
        { role: "user", content: "Question 2" },
      ],
      responseFormat: "json",
    });

    const body = JSON.parse(
      (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string,
    );
    expect(body.system).toBe("Be concise.");
    expect(body.messages).toEqual([
      { role: "user", content: "Question 1" },
      { role: "assistant", content: "Answer 1" },
      { role: "user", content: "Question 2" },
    ]);
    expect(body.model).toBe("claude-3-sonnet");
    expect(body.max_tokens).toBe(8192);
    expect(body.temperature).toBe(0.7);
  });

  it("uses custom model, temperature, and maxTokens when provided", async () => {
    const jsonPayload = { custom: true };
    fetchMock.mockResolvedValue(
      mockFetchResponse(makeAnthropicResponse(JSON.stringify(jsonPayload))),
    );

    await anthropicChat({
      ...baseOptions,
      model: "claude-3-opus",
      temperature: 0.3,
      maxTokens: 4096,
    });

    const body = JSON.parse(
      (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string,
    );
    expect(body.model).toBe("claude-3-opus");
    expect(body.temperature).toBe(0.3);
    expect(body.max_tokens).toBe(4096);
  });

  it("passes topP and stop sequences when provided", async () => {
    fetchMock.mockResolvedValue(
      mockFetchResponse(makeAnthropicResponse(JSON.stringify({ ok: true }))),
    );

    await anthropicChat({
      ...baseOptions,
      topP: 0.85,
      stop: ["END", "STOP"],
    });

    const body = JSON.parse(
      (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string,
    );
    expect(body.top_p).toBe(0.85);
    expect(body.stop_sequences).toEqual(["END", "STOP"]);
  });

  it("handles markdown-fenced JSON responses", async () => {
    const fencedJson = '```json\n{"fenced": true}\n```';
    fetchMock.mockResolvedValue(
      mockFetchResponse(makeAnthropicResponse(fencedJson)),
    );

    const result = await anthropicChat(baseOptions);
    expect(result.content).toEqual({ fenced: true });
  });
});
