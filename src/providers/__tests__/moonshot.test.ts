import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { moonshotChat } from "../moonshot.ts";
import { ProviderJsonParseError } from "../types.ts";
import type { MoonshotOptions } from "../types.ts";
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

const baseOptions: MoonshotOptions = {
  messages: [
    { role: "system", content: "You are helpful." },
    { role: "user", content: "Return JSON." },
  ],
};

describe("moonshotChat", () => {
  let originalFetch: typeof globalThis.fetch;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fetchMock: Mock<(...args: any[]) => any>;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    process.env["MOONSHOT_API_KEY"] = "test-moonshot-key";
    delete process.env["DEEPSEEK_API_KEY"];
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env["MOONSHOT_API_KEY"];
    delete process.env["DEEPSEEK_API_KEY"];
  });

  it("returns parsed JSON content with usage from streaming response", async () => {
    const jsonPayload = { result: "success", count: 42 };
    const events = makeOpenAiSseEvents(
      [JSON.stringify(jsonPayload)],
      { prompt_tokens: 15, completion_tokens: 25, total_tokens: 40 },
    );
    fetchMock.mockResolvedValue(mockStreamingResponse(events));

    const result = await moonshotChat(baseOptions);

    expect(result.content).toEqual(jsonPayload);
    expect(result.usage).toEqual({
      prompt_tokens: 15,
      completion_tokens: 25,
      total_tokens: 40,
    });
  });

  it("includes thinking parameter in request body", async () => {
    const events = makeOpenAiSseEvents([JSON.stringify({ ok: true })]);
    fetchMock.mockResolvedValue(mockStreamingResponse(events));

    await moonshotChat(baseOptions);

    const body = JSON.parse(
      (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string,
    );
    expect(body.thinking).toEqual({ type: "enabled" });
  });

  it("sends stream: true and omits response_format in request body", async () => {
    const events = makeOpenAiSseEvents([JSON.stringify({ defaults: true })]);
    fetchMock.mockResolvedValue(mockStreamingResponse(events));

    await moonshotChat({ messages: baseOptions.messages });

    const body = JSON.parse(
      (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string,
    );
    expect(body.model).toBe("kimi-k2.5");
    expect(body.max_tokens).toBe(32768);
    expect(body.thinking).toEqual({ type: "enabled" });
    expect(body.stream).toBe(true);
    expect(body.response_format).toBeUndefined();
  });

  it("throws before fetch when messages are empty", async () => {
    await expect(
      moonshotChat({ messages: [] }),
    ).rejects.toThrow(/at least one chat message/i);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends correct headers with Bearer token", async () => {
    const events = makeOpenAiSseEvents([JSON.stringify({ ok: true })]);
    fetchMock.mockResolvedValue(mockStreamingResponse(events));

    await moonshotChat(baseOptions);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.moonshot.ai/v1/chat/completions");
    const headers = init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer test-moonshot-key");
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("does not include temperature, topP, frequencyPenalty, or presencePenalty in request body", async () => {
    const events = makeOpenAiSseEvents([JSON.stringify({ ok: true })]);
    fetchMock.mockResolvedValue(mockStreamingResponse(events));

    await moonshotChat(baseOptions);

    const body = JSON.parse(
      (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string,
    );
    expect(body.temperature).toBeUndefined();
    expect(body.top_p).toBeUndefined();
    expect(body.frequency_penalty).toBeUndefined();
    expect(body.presence_penalty).toBeUndefined();
  });

  describe("content-filter fallback to DeepSeek", () => {
    it("falls back to DeepSeek with deepseek-reasoner when thinking is enabled and DEEPSEEK_API_KEY is set", async () => {
      process.env["DEEPSEEK_API_KEY"] = "test-deepseek-key";

      const contentFilterError = {
        error: { message: "Content has high risk level, request rejected." },
      };
      const deepseekPayload = { fallback: true };

      // First call: Moonshot returns 400 content-filter
      // Second call: DeepSeek returns success (also streaming now)
      const deepseekEvents = makeOpenAiSseEvents([JSON.stringify(deepseekPayload)]);
      fetchMock
        .mockResolvedValueOnce(mockErrorResponse(contentFilterError, 400))
        .mockResolvedValueOnce(mockStreamingResponse(deepseekEvents));

      const result = await moonshotChat({
        ...baseOptions,
        thinking: "enabled",
      });

      expect(result.content).toEqual(deepseekPayload);

      // Verify the DeepSeek call used deepseek-reasoner
      const secondCallBody = JSON.parse(
        (fetchMock.mock.calls[1] as [string, RequestInit])[1].body as string,
      );
      expect(secondCallBody.model).toBe("deepseek-reasoner");
    });

    it("falls back to DeepSeek with deepseek-chat when thinking is disabled", async () => {
      process.env["DEEPSEEK_API_KEY"] = "test-deepseek-key";

      const contentFilterError = {
        error: { message: "Your content was rejected by the filter." },
      };
      const deepseekPayload = { fallback: true };

      const deepseekEvents = makeOpenAiSseEvents([JSON.stringify(deepseekPayload)]);
      fetchMock
        .mockResolvedValueOnce(mockErrorResponse(contentFilterError, 400))
        .mockResolvedValueOnce(mockStreamingResponse(deepseekEvents));

      const result = await moonshotChat({
        ...baseOptions,
        thinking: "disabled",
      });

      expect(result.content).toEqual(deepseekPayload);

      const secondCallBody = JSON.parse(
        (fetchMock.mock.calls[1] as [string, RequestInit])[1].body as string,
      );
      expect(secondCallBody.model).toBe("deepseek-chat");
    });

    it("does not fall back to DeepSeek when DEEPSEEK_API_KEY is not set", async () => {
      delete process.env["DEEPSEEK_API_KEY"];

      const contentFilterError = {
        error: { message: "Content has high risk level." },
      };

      fetchMock.mockResolvedValue(
        mockErrorResponse(contentFilterError, 400),
      );

      await expect(
        moonshotChat({ ...baseOptions, maxRetries: 0 }),
      ).rejects.toMatchObject({
        status: 400,
        message: "Content has high risk level.",
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("recognizes 'high risk' in error body as content-filter error", async () => {
      process.env["DEEPSEEK_API_KEY"] = "test-deepseek-key";

      const deepseekPayload = { ok: true };
      const deepseekEvents = makeOpenAiSseEvents([JSON.stringify(deepseekPayload)]);
      fetchMock
        .mockResolvedValueOnce(
          mockErrorResponse(
            { error: { message: "This content has HIGH RISK" } },
            400,
          ),
        )
        .mockResolvedValueOnce(mockStreamingResponse(deepseekEvents));

      const result = await moonshotChat(baseOptions);
      expect(result.content).toEqual(deepseekPayload);
    });
  });

  describe("error handling", () => {
    it("throws immediately on 401 without retrying", async () => {
      fetchMock.mockResolvedValue(
        mockErrorResponse({ error: { message: "Unauthorized" } }, 401),
      );

      await expect(
        moonshotChat({ ...baseOptions, maxRetries: 3 }),
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

      const result = await moonshotChat({ ...baseOptions, maxRetries: 3 });

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(result.content).toEqual(jsonPayload);
    });

    it("does not retry ProviderJsonParseError", async () => {
      const nonJsonText = "This is plain text, not JSON at all.";
      const events = makeOpenAiSseEvents([nonJsonText]);
      fetchMock.mockResolvedValue(mockStreamingResponse(events));

      try {
        await moonshotChat({ ...baseOptions, maxRetries: 3 });
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(ProviderJsonParseError);
        const parseErr = err as ProviderJsonParseError;
        expect(parseErr.provider).toBe("moonshot");
        expect(parseErr.model).toBe("kimi-k2.5");
        expect(parseErr.sample).toBeTruthy();
      }

      // Should only have been called once — no retries on ProviderJsonParseError
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  it("uses custom thinking parameter", async () => {
    const events = makeOpenAiSseEvents([JSON.stringify({ ok: true })]);
    fetchMock.mockResolvedValue(mockStreamingResponse(events));

    await moonshotChat({ ...baseOptions, thinking: "disabled" });

    const body = JSON.parse(
      (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string,
    );
    expect(body.thinking).toEqual({ type: "disabled" });
  });

  it("handles markdown-fenced JSON responses", async () => {
    const fencedJson = '```json\n{"fenced": true}\n```';
    const events = makeOpenAiSseEvents([fencedJson]);
    fetchMock.mockResolvedValue(mockStreamingResponse(events));

    const result = await moonshotChat(baseOptions);
    expect(result.content).toEqual({ fenced: true });
  });

  it("passes an AbortSignal to fetch (IdleTimeoutController)", async () => {
    const events = makeOpenAiSseEvents([JSON.stringify({ ok: true })]);
    fetchMock.mockResolvedValue(mockStreamingResponse(events));

    await moonshotChat(baseOptions);

    const init = (fetchMock.mock.calls[0] as [string, RequestInit])[1];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  describe("streaming accumulation", () => {
    it("accumulates text across multiple SSE chunks", async () => {
      const events = [
        'data: {"choices":[{"delta":{"content":"{\\"he"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"llo\\":\\"world\\"}"}}]}\n\n',
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
        "data: [DONE]\n\n",
      ];

      fetchMock.mockResolvedValue(mockStreamingResponse(events));

      const result = await moonshotChat(baseOptions);
      expect(result.content).toEqual({ hello: "world" });
    });

    it("captures usage from the final streaming chunk", async () => {
      const events = makeOpenAiSseEvents(
        [JSON.stringify({ ok: true })],
        { prompt_tokens: 50, completion_tokens: 30, total_tokens: 80 },
      );

      fetchMock.mockResolvedValue(mockStreamingResponse(events));

      const result = await moonshotChat(baseOptions);
      expect(result.usage).toEqual({
        prompt_tokens: 50,
        completion_tokens: 30,
        total_tokens: 80,
      });
    });

    it("retries on timeout then succeeds on second attempt", async () => {
      const events = makeOpenAiSseEvents([JSON.stringify({ ok: true })]);

      fetchMock
        .mockRejectedValueOnce(
          new DOMException("signal timed out", "TimeoutError"),
        )
        .mockResolvedValueOnce(mockStreamingResponse(events));

      const result = await moonshotChat({
        ...baseOptions,
        maxRetries: 1,
      });

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(result.content).toEqual({ ok: true });
    });
  });
});
