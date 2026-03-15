import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { alibabaChat } from "../alibaba.ts";
import { ProviderJsonParseError } from "../types.ts";
import type { AlibabaOptions } from "../types.ts";
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

const baseOptions: AlibabaOptions = {
  messages: [
    { role: "system", content: "You are helpful." },
    { role: "user", content: "Return JSON." },
  ],
  responseFormat: "json_object",
};

describe("alibabaChat", () => {
  let originalFetch: typeof globalThis.fetch;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fetchMock: Mock<(...args: any[]) => any>;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    process.env["ALIBABA_API_KEY"] = "test-key";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env["ALIBABA_API_KEY"];
    delete process.env["ALIBABA_BASE_URL"];
  });

  it("returns parsed JSON content with usage on success", async () => {
    const jsonPayload = { result: "success", count: 42 };
    const events = makeOpenAiSseEvents(
      [JSON.stringify(jsonPayload)],
      { prompt_tokens: 15, completion_tokens: 25, total_tokens: 40 },
    );
    fetchMock.mockResolvedValue(mockStreamingResponse(events));

    const result = await alibabaChat(baseOptions);

    expect(result.content).toEqual(jsonPayload);
    expect(result.usage).toEqual({
      prompt_tokens: 15,
      completion_tokens: 25,
      total_tokens: 40,
    });
  });

  it("sends stream: true and stream_options in request body", async () => {
    const events = makeOpenAiSseEvents([JSON.stringify({ ok: true })]);
    fetchMock.mockResolvedValue(mockStreamingResponse(events));

    await alibabaChat(baseOptions);

    const body = JSON.parse(
      (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string,
    );
    expect(body.stream).toBe(true);
    expect(body.stream_options).toEqual({ include_usage: true });
  });

  it("throws ProviderJsonParseError on invalid JSON when responseFormat is json_object", async () => {
    const nonJsonText = "This is plain text, not JSON at all.";
    const events = makeOpenAiSseEvents([nonJsonText]);
    fetchMock.mockResolvedValue(mockStreamingResponse(events));

    try {
      await alibabaChat(baseOptions);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderJsonParseError);
      const parseErr = err as ProviderJsonParseError;
      expect(parseErr.provider).toBe("alibaba");
      expect(parseErr.model).toBe("qwen-plus");
      expect(parseErr.sample).toBeTruthy();
    }
  });

  it("retries on HTTP 500 with exponential backoff", async () => {
    const jsonPayload = { retried: true };
    const events = makeOpenAiSseEvents([JSON.stringify(jsonPayload)]);
    fetchMock
      .mockResolvedValueOnce(
        mockErrorResponse({ error: { message: "Server error" } }, 500),
      )
      .mockResolvedValueOnce(
        mockErrorResponse({ error: { message: "Server error" } }, 500),
      )
      .mockResolvedValueOnce(mockStreamingResponse(events));

    const result = await alibabaChat({ ...baseOptions, maxRetries: 3 });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.content).toEqual(jsonPayload);
  });

  it("does NOT retry on HTTP 401", async () => {
    fetchMock.mockResolvedValue(
      mockErrorResponse({ error: { message: "Unauthorized" } }, 401),
    );

    await expect(
      alibabaChat({ ...baseOptions, maxRetries: 3 }),
    ).rejects.toMatchObject({ status: 401, message: "Unauthorized" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("uses ALIBABA_BASE_URL env var when set", async () => {
    process.env["ALIBABA_BASE_URL"] = "https://custom.api.example.com";
    const events = makeOpenAiSseEvents([JSON.stringify({ ok: true })]);
    fetchMock.mockResolvedValue(mockStreamingResponse(events));

    await alibabaChat(baseOptions);

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://custom.api.example.com/chat/completions",
    );
  });

  it("passes frequencyPenalty and presencePenalty in request body", async () => {
    const events = makeOpenAiSseEvents([JSON.stringify({ ok: true })]);
    fetchMock.mockResolvedValue(mockStreamingResponse(events));

    await alibabaChat({
      ...baseOptions,
      frequencyPenalty: 0.5,
      presencePenalty: 0.2,
    });

    const body = JSON.parse(
      (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string,
    );
    expect(body.frequency_penalty).toBe(0.5);
    expect(body.presence_penalty).toBe(0.2);
  });

  it("passes an AbortSignal to fetch (IdleTimeoutController)", async () => {
    const events = makeOpenAiSseEvents([JSON.stringify({ ok: true })]);
    fetchMock.mockResolvedValue(mockStreamingResponse(events));

    await alibabaChat(baseOptions);

    const init = (fetchMock.mock.calls[0] as [string, RequestInit])[1];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("sends enable_thinking true by default", async () => {
    const events = makeOpenAiSseEvents([JSON.stringify({ ok: true })]);
    fetchMock.mockResolvedValue(mockStreamingResponse(events));

    await alibabaChat(baseOptions);

    const body = JSON.parse(
      (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string,
    );
    expect(body.enable_thinking).toBe(true);
  });

  it("sends enable_thinking false when thinking is disabled", async () => {
    const events = makeOpenAiSseEvents([JSON.stringify({ ok: true })]);
    fetchMock.mockResolvedValue(mockStreamingResponse(events));

    await alibabaChat({ ...baseOptions, thinking: "disabled" });

    const body = JSON.parse(
      (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string,
    );
    expect(body.enable_thinking).toBe(false);
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

      const result = await alibabaChat(baseOptions);
      expect(result.content).toEqual({ hello: "world" });
    });

    it("captures usage from the final streaming chunk", async () => {
      const events = makeOpenAiSseEvents(
        [JSON.stringify({ ok: true })],
        { prompt_tokens: 50, completion_tokens: 30, total_tokens: 80 },
      );

      fetchMock.mockResolvedValue(mockStreamingResponse(events));

      const result = await alibabaChat(baseOptions);
      expect(result.usage).toEqual({
        prompt_tokens: 50,
        completion_tokens: 30,
        total_tokens: 80,
      });
    });

    it("defaults usage to zeros when stream provides no usage", async () => {
      const events = makeOpenAiSseEvents([JSON.stringify({ ok: true })]);

      fetchMock.mockResolvedValue(mockStreamingResponse(events));

      const result = await alibabaChat(baseOptions);
      expect(result.usage).toEqual({
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
      });
    });

    it("retries on timeout then succeeds on second attempt", async () => {
      const events = makeOpenAiSseEvents([JSON.stringify({ ok: true })]);

      fetchMock
        .mockRejectedValueOnce(
          new DOMException("signal timed out", "TimeoutError"),
        )
        .mockResolvedValueOnce(mockStreamingResponse(events));

      const result = await alibabaChat({
        ...baseOptions,
        maxRetries: 1,
      });

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(result.content).toEqual({ ok: true });
    });
  });
});
