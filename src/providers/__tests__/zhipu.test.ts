import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { zaiChat, zhipuChat } from "../zhipu.ts";
import { ProviderJsonModeError, ProviderJsonParseError } from "../types.ts";
import type { ProviderOptions } from "../types.ts";
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

const baseOptions: ProviderOptions = {
  messages: [
    { role: "system", content: "You are helpful." },
    { role: "user", content: "Return JSON." },
  ],
  responseFormat: "json",
};

describe("zhipuChat", () => {
  let originalFetch: typeof globalThis.fetch;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fetchMock: Mock<(...args: any[]) => any>;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    process.env["ZAI_API_KEY"] = "test-key";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env["ZAI_API_KEY"];
    delete process.env["ZHIPU_API_KEY"];
  });

  it("returns parsed JSON content, correct usage, and text for a valid response", async () => {
    const jsonPayload = { result: "success", count: 42 };
    const events = makeOpenAiSseEvents(
      [JSON.stringify(jsonPayload)],
      { prompt_tokens: 15, completion_tokens: 25, total_tokens: 40 },
    );
    fetchMock.mockResolvedValue(mockStreamingResponse(events));

    const result = await zhipuChat(baseOptions);

    expect(result.content).toEqual(jsonPayload);
    expect(result.text).toBe(JSON.stringify(jsonPayload));
    expect(result.usage).toEqual({
      prompt_tokens: 15,
      completion_tokens: 25,
      total_tokens: 40,
    });
  });

  it("sends stream: true in request body", async () => {
    const events = makeOpenAiSseEvents([JSON.stringify({ ok: true })]);
    fetchMock.mockResolvedValue(mockStreamingResponse(events));

    await zhipuChat(baseOptions);

    const body = JSON.parse(
      (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string,
    );
    expect(body.stream).toBe(true);
  });

  it("sends request to the correct Zhipu endpoint with OpenAI-compatible format", async () => {
    const events = makeOpenAiSseEvents([JSON.stringify({ ok: true })]);
    fetchMock.mockResolvedValue(mockStreamingResponse(events));

    await zhipuChat(baseOptions);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.z.ai/api/paas/v4/chat/completions");

    const headers = init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["Authorization"]).toBe("Bearer test-key");

    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("glm-5");
    expect(body.temperature).toBe(0.7);
    expect(body.max_tokens).toBe(8192);
    expect(body.messages).toBeDefined();
    expect(Array.isArray(body.messages)).toBe(true);
  });

  it("constructs OpenAI-compatible messages with system message and conversation order", async () => {
    const events = makeOpenAiSseEvents([JSON.stringify({ ok: true })]);
    fetchMock.mockResolvedValue(mockStreamingResponse(events));

    await zhipuChat({
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

    expect(body.messages).toEqual([
      { role: "system", content: "Be concise." },
      { role: "user", content: "Question 1" },
      { role: "assistant", content: "Answer 1" },
      { role: "user", content: "Question 2" },
    ]);
  });

  it("injects JSON schema into system instruction when responseFormat has json_schema", async () => {
    const schema = {
      type: "object",
      properties: { name: { type: "string" } },
    };
    const events = makeOpenAiSseEvents([JSON.stringify({ name: "test" })]);
    fetchMock.mockResolvedValue(mockStreamingResponse(events));

    await zhipuChat({
      messages: [
        { role: "system", content: "You are helpful." },
        { role: "user", content: "Give me a name." },
      ],
      responseFormat: { json_schema: schema },
    });

    const body = JSON.parse(
      (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string,
    );

    const systemMessage = body.messages.find(
      (m: { role: string }) => m.role === "system",
    );
    expect(systemMessage).toBeDefined();
    expect(systemMessage.content).toContain("You are helpful.");
    expect(systemMessage.content).toContain("Respond with JSON matching this schema:");
    expect(systemMessage.content).toContain('"type": "object"');
  });

  it("creates system message from schema alone when no system message exists", async () => {
    const schema = { type: "object" };
    const events = makeOpenAiSseEvents([JSON.stringify({})]);
    fetchMock.mockResolvedValue(mockStreamingResponse(events));

    await zhipuChat({
      messages: [{ role: "user", content: "Do something." }],
      responseFormat: { json_schema: schema },
    });

    const body = JSON.parse(
      (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string,
    );

    const systemMessage = body.messages.find(
      (m: { role: string }) => m.role === "system",
    );
    expect(systemMessage).toBeDefined();
    expect(systemMessage.content).toContain("Respond with JSON matching this schema:");
  });

  it("does not include response_format in body when json_schema is used", async () => {
    const schema = { type: "object" };
    const events = makeOpenAiSseEvents([JSON.stringify({})]);
    fetchMock.mockResolvedValue(mockStreamingResponse(events));

    await zhipuChat({
      messages: [{ role: "user", content: "Do something." }],
      responseFormat: { json_schema: schema },
    });

    const body = JSON.parse(
      (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string,
    );

    expect(body.response_format).toBeUndefined();
  });

  it("includes response_format json_object for standard JSON mode", async () => {
    const events = makeOpenAiSseEvents([JSON.stringify({ ok: true })]);
    fetchMock.mockResolvedValue(mockStreamingResponse(events));

    await zhipuChat({
      messages: [{ role: "user", content: "Return JSON." }],
      responseFormat: "json",
    });

    const body = JSON.parse(
      (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string,
    );

    expect(body.response_format).toEqual({ type: "json_object" });
  });

  it("normalizes usage from streaming response", async () => {
    const events = makeOpenAiSseEvents(
      [JSON.stringify({ ok: true })],
      { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
    );
    fetchMock.mockResolvedValue(mockStreamingResponse(events));

    const result = await zhipuChat(baseOptions);

    expect(result.usage).toEqual({
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150,
    });
  });

  it("handles missing usage by defaulting to zeros", async () => {
    const events = makeOpenAiSseEvents([JSON.stringify({ ok: true })]);
    fetchMock.mockResolvedValue(mockStreamingResponse(events));

    const result = await zhipuChat(baseOptions);

    expect(result.usage).toEqual({
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    });
  });

  it("throws immediately on 401 without retrying", async () => {
    fetchMock.mockResolvedValue(
      mockErrorResponse({ error: { message: "Unauthorized" } }, 401),
    );

    await expect(
      zhipuChat({ ...baseOptions, maxRetries: 3 }),
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

    const result = await zhipuChat({
      ...baseOptions,
      maxRetries: 3,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.content).toEqual(jsonPayload);
  });

  it("throws ProviderJsonModeError when responseFormat is invalid", async () => {
    await expect(
      zhipuChat({
        ...baseOptions,
        responseFormat: "text",
      }),
    ).rejects.toThrow(ProviderJsonModeError);
  });

  it("throws ProviderJsonParseError for non-JSON text in JSON mode", async () => {
    const nonJsonText = "This is plain text, not JSON at all.";
    const events = makeOpenAiSseEvents([nonJsonText]);
    fetchMock.mockResolvedValue(mockStreamingResponse(events));

    try {
      await zhipuChat(baseOptions);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderJsonParseError);
      const parseErr = err as ProviderJsonParseError;
      expect(parseErr.provider).toBe("zai");
      expect(parseErr.model).toBe("glm-5");
      expect(parseErr.sample).toBeTruthy();
    }
  });

  it("handles markdown-fenced JSON responses", async () => {
    const fencedJson = '```json\n{"fenced": true}\n```';
    const events = makeOpenAiSseEvents([fencedJson]);
    fetchMock.mockResolvedValue(mockStreamingResponse(events));

    const result = await zhipuChat(baseOptions);
    expect(result.content).toEqual({ fenced: true });
  });

  it("uses custom model, temperature, and maxTokens when provided", async () => {
    const events = makeOpenAiSseEvents([JSON.stringify({ custom: true })]);
    fetchMock.mockResolvedValue(mockStreamingResponse(events));

    await zhipuChat({
      ...baseOptions,
      model: "glm-4",
      temperature: 0.3,
      maxTokens: 4096,
    });

    const body = JSON.parse(
      (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string,
    );
    expect(body.model).toBe("glm-4");
    expect(body.temperature).toBe(0.3);
    expect(body.max_tokens).toBe(4096);
  });

  it("passes topP and stop when provided", async () => {
    const events = makeOpenAiSseEvents([JSON.stringify({ ok: true })]);
    fetchMock.mockResolvedValue(mockStreamingResponse(events));

    await zhipuChat({
      ...baseOptions,
      topP: 0.9,
      stop: "DONE",
    });

    const body = JSON.parse(
      (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string,
    );
    expect(body.top_p).toBe(0.9);
    expect(body.stop).toBe("DONE");
  });

  it("passes an AbortSignal to fetch (IdleTimeoutController)", async () => {
    const events = makeOpenAiSseEvents([JSON.stringify({ ok: true })]);
    fetchMock.mockResolvedValue(mockStreamingResponse(events));

    await zhipuChat(baseOptions);

    const init = (fetchMock.mock.calls[0] as [string, RequestInit])[1];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("exports zaiChat as the canonical adapter", () => {
    expect(zaiChat).toBe(zhipuChat);
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

      const result = await zhipuChat(baseOptions);
      expect(result.content).toEqual({ hello: "world" });
    });

    it("captures usage from the final streaming chunk", async () => {
      const events = makeOpenAiSseEvents(
        [JSON.stringify({ ok: true })],
        { prompt_tokens: 50, completion_tokens: 30, total_tokens: 80 },
      );

      fetchMock.mockResolvedValue(mockStreamingResponse(events));

      const result = await zhipuChat(baseOptions);
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

      const result = await zhipuChat({
        ...baseOptions,
        maxRetries: 1,
      });

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(result.content).toEqual({ ok: true });
    });
  });
});
