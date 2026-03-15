import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { deepseekChat } from "../deepseek.ts";
import { ProviderJsonParseError } from "../types.ts";
import type { DeepSeekOptions } from "../types.ts";
import type { Mock } from "vitest";

/**
 * Creates a mock ReadableStream that yields SSE-formatted data.
 */
function makeSSEStream(events: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const chunks = events.map((e) => encoder.encode(e));
  let index = 0;

  return new ReadableStream({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(chunks[index]!);
        index++;
      } else {
        controller.close();
      }
    },
  });
}

function mockStreamingResponse(events: string[], status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    body: makeSSEStream(events),
    json: vi.fn(),
    text: vi.fn(),
  } as unknown as Response;
}

function mockErrorResponse(body: unknown, status: number) {
  return {
    ok: false,
    status,
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(JSON.stringify(body)),
  } as unknown as Response;
}

/**
 * Builds SSE events for an OpenAI-compatible streaming response.
 */
function makeOpenAiSseEvents(
  textChunks: string[],
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number },
): string[] {
  const events: string[] = [];
  for (const chunk of textChunks) {
    events.push(
      `data: ${JSON.stringify({ choices: [{ delta: { content: chunk } }] })}\n\n`,
    );
  }
  if (usage) {
    events.push(
      `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], usage })}\n\n`,
    );
  } else {
    events.push(
      `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`,
    );
  }
  events.push("data: [DONE]\n\n");
  return events;
}

const baseOptions: DeepSeekOptions = {
  messages: [
    { role: "system", content: "You are helpful." },
    { role: "user", content: "Return JSON." },
  ],
  responseFormat: "json_object",
};

describe("deepseekChat", () => {
  let originalFetch: typeof globalThis.fetch;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fetchMock: Mock<(...args: any[]) => any>;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    process.env["DEEPSEEK_API_KEY"] = "test-key";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env["DEEPSEEK_API_KEY"];
  });

  it("returns parsed JSON content with usage from streaming response", async () => {
    const jsonPayload = { result: "success", count: 42 };
    const jsonStr = JSON.stringify(jsonPayload);
    const events = makeOpenAiSseEvents(
      [jsonStr],
      { prompt_tokens: 15, completion_tokens: 25, total_tokens: 40 },
    );
    fetchMock.mockResolvedValue(mockStreamingResponse(events));

    const result = await deepseekChat(baseOptions);

    expect(result.content).toEqual(jsonPayload);
    expect(result.usage).toEqual({
      prompt_tokens: 15,
      completion_tokens: 25,
      total_tokens: 40,
    });
  });

  it("sends correct headers with Bearer token", async () => {
    const events = makeOpenAiSseEvents([JSON.stringify({ ok: true })]);
    fetchMock.mockResolvedValue(mockStreamingResponse(events));

    await deepseekChat(baseOptions);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.deepseek.com/chat/completions");
    const headers = init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer test-key");
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("always sends stream: true and omits response_format", async () => {
    const events = makeOpenAiSseEvents([JSON.stringify({ ok: true })]);
    fetchMock.mockResolvedValue(mockStreamingResponse(events));

    await deepseekChat(baseOptions);

    const body = JSON.parse(
      (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string,
    );
    expect(body.stream).toBe(true);
    expect(body.response_format).toBeUndefined();
  });

  it("throws immediately on 401 without retrying", async () => {
    fetchMock.mockResolvedValue(
      mockErrorResponse({ error: { message: "Unauthorized" } }, 401),
    );

    await expect(
      deepseekChat({ ...baseOptions, maxRetries: 3 }),
    ).rejects.toMatchObject({ status: 401, message: "Unauthorized" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries on 429 then succeeds on 200", async () => {
    const jsonPayload = { retried: true };
    const events = makeOpenAiSseEvents([JSON.stringify(jsonPayload)]);
    fetchMock
      .mockResolvedValueOnce(
        mockErrorResponse({ error: { message: "Rate limited" } }, 429),
      )
      .mockResolvedValueOnce(mockStreamingResponse(events));

    const result = await deepseekChat({ ...baseOptions, maxRetries: 3 });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.content).toEqual(jsonPayload);
  });

  it("throws ProviderJsonParseError for non-JSON text in JSON mode", async () => {
    const nonJsonText = "This is plain text, not JSON at all.";
    const events = makeOpenAiSseEvents([nonJsonText]);
    fetchMock.mockResolvedValue(mockStreamingResponse(events));

    try {
      await deepseekChat(baseOptions);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderJsonParseError);
      const parseErr = err as ProviderJsonParseError;
      expect(parseErr.provider).toBe("deepseek");
      expect(parseErr.model).toBe("deepseek-chat");
      expect(parseErr.sample).toBeTruthy();
    }
  });

  it("handles markdown-fenced JSON responses", async () => {
    const fencedJson = '```json\n{"fenced": true}\n```';
    const events = makeOpenAiSseEvents([fencedJson]);
    fetchMock.mockResolvedValue(mockStreamingResponse(events));

    const result = await deepseekChat(baseOptions);
    expect(result.content).toEqual({ fenced: true });
  });

  it("uses default model and temperature", async () => {
    const events = makeOpenAiSseEvents([JSON.stringify({ defaults: true })]);
    fetchMock.mockResolvedValue(mockStreamingResponse(events));

    await deepseekChat({
      messages: baseOptions.messages,
    });

    const body = JSON.parse(
      (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string,
    );
    expect(body.model).toBe("deepseek-chat");
    expect(body.temperature).toBe(0.7);
  });

  it("passes optional parameters when provided", async () => {
    const events = makeOpenAiSseEvents([JSON.stringify({ ok: true })]);
    fetchMock.mockResolvedValue(mockStreamingResponse(events));

    await deepseekChat({
      ...baseOptions,
      model: "deepseek-reasoner",
      temperature: 0.3,
      maxTokens: 4096,
      topP: 0.9,
      frequencyPenalty: 0.5,
      presencePenalty: 0.2,
    });

    const body = JSON.parse(
      (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string,
    );
    expect(body.model).toBe("deepseek-reasoner");
    expect(body.temperature).toBe(0.3);
    expect(body.max_tokens).toBe(4096);
    expect(body.top_p).toBe(0.9);
    expect(body.frequency_penalty).toBe(0.5);
    expect(body.presence_penalty).toBe(0.2);
  });

  it("passes an AbortSignal to fetch (IdleTimeoutController)", async () => {
    const events = makeOpenAiSseEvents([JSON.stringify({ ok: true })]);
    fetchMock.mockResolvedValue(mockStreamingResponse(events));

    await deepseekChat(baseOptions);

    const init = (fetchMock.mock.calls[0] as [string, RequestInit])[1];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  describe("streaming accumulation", () => {
    it("accumulates text across multiple SSE chunks", async () => {
      const events = [
        'data: {"choices":[{"delta":{"content":"{\\"hello"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"\\":\\"world\\"}"}}]}\n\n',
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
        "data: [DONE]\n\n",
      ];

      fetchMock.mockResolvedValue(mockStreamingResponse(events));

      const result = await deepseekChat(baseOptions);
      expect(result.content).toEqual({ hello: "world" });
    });

    it("captures usage from the final streaming chunk", async () => {
      const events = [
        'data: {"choices":[{"delta":{"content":"{\\"ok\\":true}"}}]}\n\n',
        `data: ${JSON.stringify({
          choices: [{ delta: {}, finish_reason: "stop" }],
          usage: { prompt_tokens: 50, completion_tokens: 30, total_tokens: 80 },
        })}\n\n`,
        "data: [DONE]\n\n",
      ];

      fetchMock.mockResolvedValue(mockStreamingResponse(events));

      const result = await deepseekChat(baseOptions);
      expect(result.usage).toEqual({
        prompt_tokens: 50,
        completion_tokens: 30,
        total_tokens: 80,
      });
    });

    it("defaults usage to zeros when stream provides no usage", async () => {
      const events = [
        'data: {"choices":[{"delta":{"content":"{\\"ok\\":true}"}}]}\n\n',
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
        "data: [DONE]\n\n",
      ];

      fetchMock.mockResolvedValue(mockStreamingResponse(events));

      const result = await deepseekChat(baseOptions);
      expect(result.usage).toEqual({
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
      });
    });

    it("skips SSE comment lines and empty lines", async () => {
      const events = [
        ": this is a comment\n\n",
        "\n",
        'data: {"choices":[{"delta":{"content":"{\\"only\\":true}"}}]}\n\n',
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
        "data: [DONE]\n\n",
      ];

      fetchMock.mockResolvedValue(mockStreamingResponse(events));

      const result = await deepseekChat(baseOptions);
      expect(result.content).toEqual({ only: true });
    });

    it("skips chunks with no content in delta", async () => {
      const events = [
        'data: {"choices":[{"delta":{}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"{\\"real\\":true}"}}]}\n\n',
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
        "data: [DONE]\n\n",
      ];

      fetchMock.mockResolvedValue(mockStreamingResponse(events));

      const result = await deepseekChat(baseOptions);
      expect(result.content).toEqual({ real: true });
    });

    it("retries on timeout then succeeds on second attempt", async () => {
      const events = makeOpenAiSseEvents([JSON.stringify({ ok: true })]);

      fetchMock
        .mockRejectedValueOnce(
          new DOMException("signal timed out", "TimeoutError"),
        )
        .mockResolvedValueOnce(mockStreamingResponse(events));

      const result = await deepseekChat({
        ...baseOptions,
        maxRetries: 1,
      });

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(result.content).toEqual({ ok: true });
    });

    it("normalizes negative maxRetries to zero", async () => {
      fetchMock.mockResolvedValue(
        mockErrorResponse({ error: { message: "Server error" } }, 500),
      );

      await expect(
        deepseekChat({ ...baseOptions, maxRetries: -2 }),
      ).rejects.toMatchObject({ status: 500, message: "Server error" });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("throws on malformed JSON in SSE data", async () => {
      const events = [
        "data: {not valid json\n\n",
        'data: {"choices":[{"delta":{"content":"not json"}}]}\n\n',
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
        "data: [DONE]\n\n",
      ];

      fetchMock.mockResolvedValue(mockStreamingResponse(events));

      // Malformed SSE data lines are skipped, but the accumulated text may fail JSON parse
      await expect(deepseekChat(baseOptions)).rejects.toBeInstanceOf(
        ProviderJsonParseError,
      );
    });
  });
});
