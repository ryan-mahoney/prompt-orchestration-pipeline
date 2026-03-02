import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { deepseekChat } from "../deepseek.ts";
import { ProviderJsonParseError } from "../types.ts";
import type { DeepSeekOptions } from "../types.ts";
import type { Mock } from "vitest";

function makeDeepSeekResponse(
  content: string,
  promptTokens = 10,
  completionTokens = 20,
) {
  return {
    choices: [{ message: { content } }],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
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

function mockStreamingResponse(events: string[]) {
  return {
    ok: true,
    status: 200,
    body: makeSSEStream(events),
    json: vi.fn(),
    text: vi.fn(),
  } as unknown as Response;
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

  describe("non-streaming", () => {
    it("returns parsed JSON content with usage", async () => {
      const jsonPayload = { result: "success", count: 42 };
      fetchMock.mockResolvedValue(
        mockFetchResponse(
          makeDeepSeekResponse(JSON.stringify(jsonPayload), 15, 25),
        ),
      );

      const result = await deepseekChat(baseOptions);

      expect(result.content).toEqual(jsonPayload);
      expect(result.usage).toEqual({
        prompt_tokens: 15,
        completion_tokens: 25,
        total_tokens: 40,
      });
      expect(result.raw).toBeDefined();
    });

    it("sends correct headers with Bearer token", async () => {
      const jsonPayload = { ok: true };
      fetchMock.mockResolvedValue(
        mockFetchResponse(makeDeepSeekResponse(JSON.stringify(jsonPayload))),
      );

      await deepseekChat(baseOptions);

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://api.deepseek.com/chat/completions");
      const headers = init.headers as Record<string, string>;
      expect(headers["Authorization"]).toBe("Bearer test-key");
      expect(headers["Content-Type"]).toBe("application/json");
    });

    it("includes response_format in non-streaming request body", async () => {
      const jsonPayload = { ok: true };
      fetchMock.mockResolvedValue(
        mockFetchResponse(makeDeepSeekResponse(JSON.stringify(jsonPayload))),
      );

      await deepseekChat(baseOptions);

      const body = JSON.parse(
        (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string,
      );
      expect(body.response_format).toEqual({ type: "json_object" });
      expect(body.stream).toBe(false);
    });

    it("throws immediately on 401 without retrying", async () => {
      fetchMock.mockResolvedValue(
        mockFetchResponse({ error: { message: "Unauthorized" } }, 401),
      );

      await expect(
        deepseekChat({ ...baseOptions, maxRetries: 3 }),
      ).rejects.toMatchObject({ status: 401, message: "Unauthorized" });

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("retries on 429 then succeeds on 200", async () => {
      const jsonPayload = { retried: true };
      fetchMock
        .mockResolvedValueOnce(
          mockFetchResponse({ error: { message: "Rate limited" } }, 429),
        )
        .mockResolvedValueOnce(
          mockFetchResponse(
            makeDeepSeekResponse(JSON.stringify(jsonPayload)),
          ),
        );

      const result = await deepseekChat({ ...baseOptions, maxRetries: 3 });

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(result.content).toEqual(jsonPayload);
    });

    it("throws ProviderJsonParseError for non-JSON text in JSON mode", async () => {
      const nonJsonText = "This is plain text, not JSON at all.";
      fetchMock.mockResolvedValue(
        mockFetchResponse(makeDeepSeekResponse(nonJsonText)),
      );

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
      fetchMock.mockResolvedValue(
        mockFetchResponse(makeDeepSeekResponse(fencedJson)),
      );

      const result = await deepseekChat(baseOptions);
      expect(result.content).toEqual({ fenced: true });
    });

    it("uses default model and temperature", async () => {
      const jsonPayload = { defaults: true };
      fetchMock.mockResolvedValue(
        mockFetchResponse(makeDeepSeekResponse(JSON.stringify(jsonPayload))),
      );

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
      const jsonPayload = { ok: true };
      fetchMock.mockResolvedValue(
        mockFetchResponse(makeDeepSeekResponse(JSON.stringify(jsonPayload))),
      );

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
  });

  describe("streaming", () => {
    it("returns an async generator that yields chunks from SSE", async () => {
      const sseEvents = [
        'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":" world"}}]}\n\n',
        "data: [DONE]\n\n",
      ];

      fetchMock.mockResolvedValue(mockStreamingResponse(sseEvents));

      const generator = await deepseekChat({
        ...baseOptions,
        stream: true,
      });

      const chunks: string[] = [];
      for await (const chunk of generator) {
        chunks.push(chunk.content);
      }

      expect(chunks).toEqual(["Hello", " world"]);
    });

    it("omits response_format when stream is true", async () => {
      const sseEvents = [
        'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n',
        "data: [DONE]\n\n",
      ];

      fetchMock.mockResolvedValue(mockStreamingResponse(sseEvents));

      await deepseekChat({
        ...baseOptions,
        stream: true,
        responseFormat: "json_object",
      });

      const body = JSON.parse(
        (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string,
      );
      expect(body.response_format).toBeUndefined();
      expect(body.stream).toBe(true);
    });

    it("throws on non-ok streaming response", async () => {
      fetchMock.mockResolvedValue(
        mockFetchResponse({ error: { message: "Server error" } }, 500),
      );

      await expect(
        deepseekChat({ ...baseOptions, stream: true }),
      ).rejects.toMatchObject({ status: 500, message: "Server error" });
    });

    it("skips SSE lines that are comments or empty", async () => {
      const sseEvents = [
        ": this is a comment\n\n",
        "\n",
        'data: {"choices":[{"delta":{"content":"only"}}]}\n\n',
        "data: [DONE]\n\n",
      ];

      fetchMock.mockResolvedValue(mockStreamingResponse(sseEvents));

      const generator = await deepseekChat({
        ...baseOptions,
        stream: true,
      });

      const chunks: string[] = [];
      for await (const chunk of generator) {
        chunks.push(chunk.content);
      }

      expect(chunks).toEqual(["only"]);
    });

    it("skips chunks with no content in delta", async () => {
      const sseEvents = [
        'data: {"choices":[{"delta":{}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"real"}}]}\n\n',
        "data: [DONE]\n\n",
      ];

      fetchMock.mockResolvedValue(mockStreamingResponse(sseEvents));

      const generator = await deepseekChat({
        ...baseOptions,
        stream: true,
      });

      const chunks: string[] = [];
      for await (const chunk of generator) {
        chunks.push(chunk.content);
      }

      expect(chunks).toEqual(["real"]);
    });
  });
});
