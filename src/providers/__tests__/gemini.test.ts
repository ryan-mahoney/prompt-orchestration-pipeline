import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { geminiChat } from "../gemini.ts";
import { ProviderJsonModeError, ProviderJsonParseError } from "../types.ts";
import type { GeminiOptions } from "../types.ts";
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
 * Builds SSE events for a Gemini streaming response.
 */
function makeGeminiSseEvents(
  text: string,
  promptTokens = 10,
  candidatesTokens = 20,
  totalTokens = 30,
): string[] {
  return [
    `data: ${JSON.stringify({
      candidates: [{ content: { parts: [{ text }], role: "model" } }],
    })}\n\n`,
    `data: ${JSON.stringify({
      candidates: [{ content: { parts: [{ text: "" }], role: "model" }, finishReason: "STOP" }],
      usageMetadata: {
        promptTokenCount: promptTokens,
        candidatesTokenCount: candidatesTokens,
        totalTokenCount: totalTokens,
      },
    })}\n\n`,
  ];
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

const baseOptions: GeminiOptions = {
  messages: [
    { role: "system", content: "You are helpful." },
    { role: "user", content: "Return JSON." },
  ],
  responseFormat: "json",
};

describe("geminiChat", () => {
  let originalFetch: typeof globalThis.fetch;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fetchMock: Mock<(...args: any[]) => any>;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    process.env["GEMINI_API_KEY"] = "test-key";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env["GEMINI_API_KEY"];
    delete process.env["GEMINI_BASE_URL"];
  });

  it("returns parsed JSON content, correct usage, and text for a valid response", async () => {
    const jsonPayload = { result: "success", count: 42 };
    const events = makeGeminiSseEvents(
      JSON.stringify(jsonPayload),
      15,
      25,
      40,
    );
    fetchMock.mockResolvedValue(mockStreamingResponse(events));

    const result = await geminiChat(baseOptions);

    expect(result.content).toEqual(jsonPayload);
    expect(result.text).toBe(JSON.stringify(jsonPayload));
    expect(result.usage).toEqual({
      prompt_tokens: 15,
      completion_tokens: 25,
      total_tokens: 40,
    });
  });

  it("includes safetySettings with BLOCK_NONE for all four categories", async () => {
    const events = makeGeminiSseEvents(JSON.stringify({ ok: true }));
    fetchMock.mockResolvedValue(mockStreamingResponse(events));

    await geminiChat(baseOptions);

    const body = JSON.parse(
      (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string,
    );

    expect(body.safetySettings).toHaveLength(4);

    const expectedCategories = [
      "HARM_CATEGORY_HARASSMENT",
      "HARM_CATEGORY_HATE_SPEECH",
      "HARM_CATEGORY_SEXUALLY_EXPLICIT",
      "HARM_CATEGORY_DANGEROUS_CONTENT",
    ];

    for (const category of expectedCategories) {
      const setting = body.safetySettings.find(
        (s: { category: string }) => s.category === category,
      );
      expect(setting).toBeDefined();
      expect(setting.threshold).toBe("BLOCK_NONE");
    }
  });

  it("constructs contents and systemInstruction in Gemini format", async () => {
    const events = makeGeminiSseEvents(JSON.stringify({ ok: true }));
    fetchMock.mockResolvedValue(mockStreamingResponse(events));

    await geminiChat({
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

    expect(body.systemInstruction).toEqual({
      parts: [{ text: "Be concise." }],
    });

    expect(body.contents).toEqual([
      { role: "user", parts: [{ text: "Question 1" }] },
      { role: "model", parts: [{ text: "Answer 1" }] },
      { role: "user", parts: [{ text: "Question 2" }] },
    ]);
  });

  it("injects JSON schema into system instruction when responseFormat has json_schema", async () => {
    const schema = {
      type: "object",
      properties: { name: { type: "string" } },
    };
    const events = makeGeminiSseEvents(JSON.stringify({ name: "test" }));
    fetchMock.mockResolvedValue(mockStreamingResponse(events));

    await geminiChat({
      messages: [
        { role: "system", content: "You are helpful." },
        { role: "user", content: "Give me a name." },
      ],
      responseFormat: { json_schema: schema },
    });

    const body = JSON.parse(
      (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string,
    );

    const systemText = body.systemInstruction.parts[0].text as string;
    expect(systemText).toContain("You are helpful.");
    expect(systemText).toContain("Respond with JSON matching this schema:");
    expect(systemText).toContain('"type": "object"');
  });

  it("creates systemInstruction from schema alone when no system message exists", async () => {
    const schema = { type: "object" };
    const events = makeGeminiSseEvents(JSON.stringify({}));
    fetchMock.mockResolvedValue(mockStreamingResponse(events));

    await geminiChat({
      messages: [{ role: "user", content: "Do something." }],
      responseFormat: { json_schema: schema },
    });

    const body = JSON.parse(
      (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string,
    );

    expect(body.systemInstruction).toBeDefined();
    const systemText = body.systemInstruction.parts[0].text as string;
    expect(systemText).toContain("Respond with JSON matching this schema:");
  });

  it("normalizes usage from Gemini's usageMetadata format", async () => {
    const events = makeGeminiSseEvents(
      JSON.stringify({ ok: true }),
      100,
      50,
      150,
    );
    fetchMock.mockResolvedValue(mockStreamingResponse(events));

    const result = await geminiChat(baseOptions);

    expect(result.usage).toEqual({
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150,
    });
  });

  it("uses streamGenerateContent URL with alt=sse", async () => {
    const events = makeGeminiSseEvents(JSON.stringify({ ok: true }));
    fetchMock.mockResolvedValue(mockStreamingResponse(events));

    await geminiChat(baseOptions);

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/models/gemini-2.5-flash:streamGenerateContent?alt=sse");
  });

  it("passes API key as query parameter", async () => {
    const events = makeGeminiSseEvents(JSON.stringify({ ok: true }));
    fetchMock.mockResolvedValue(mockStreamingResponse(events));

    await geminiChat(baseOptions);

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("key=test-key");
  });

  it("uses GEMINI_BASE_URL env var when set", async () => {
    process.env["GEMINI_BASE_URL"] = "https://custom.api.example.com/v1";
    const events = makeGeminiSseEvents(JSON.stringify({ ok: true }));
    fetchMock.mockResolvedValue(mockStreamingResponse(events));

    await geminiChat(baseOptions);

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url.startsWith("https://custom.api.example.com/v1/models/")).toBe(true);
  });

  it("throws immediately on 401 without retrying", async () => {
    fetchMock.mockResolvedValue(
      mockErrorResponse({ error: { message: "Unauthorized" } }, 401),
    );

    await expect(
      geminiChat({ ...baseOptions, maxRetries: 3 }),
    ).rejects.toMatchObject({ status: 401, message: "Unauthorized" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries on 429 then succeeds on 200", async () => {
    const jsonPayload = { retried: true };
    const events = makeGeminiSseEvents(JSON.stringify(jsonPayload));
    fetchMock
      .mockResolvedValueOnce(
        mockErrorResponse({ error: { message: "Rate limited" } }, 429),
      )
      .mockResolvedValueOnce(mockStreamingResponse(events));

    const result = await geminiChat({
      ...baseOptions,
      maxRetries: 3,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.content).toEqual(jsonPayload);
  });

  it("throws ProviderJsonModeError when responseFormat is invalid", async () => {
    await expect(
      geminiChat({
        ...baseOptions,
        responseFormat: "text",
      }),
    ).rejects.toThrow(ProviderJsonModeError);
  });

  it("throws ProviderJsonParseError for non-JSON text in JSON mode", async () => {
    const nonJsonText = "This is plain text, not JSON at all.";
    const events = makeGeminiSseEvents(nonJsonText);
    fetchMock.mockResolvedValue(mockStreamingResponse(events));

    try {
      await geminiChat(baseOptions);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderJsonParseError);
      const parseErr = err as ProviderJsonParseError;
      expect(parseErr.provider).toBe("gemini");
      expect(parseErr.model).toBe("gemini-2.5-flash");
      expect(parseErr.sample).toBeTruthy();
    }
  });

  it("returns plain text content when responseFormat is not specified", async () => {
    const plainText = "Hello, this is a plain text response.";
    // For non-JSON mode, single chunk with finishReason
    const events = [
      `data: ${JSON.stringify({
        candidates: [{ content: { parts: [{ text: plainText }], role: "model" }, finishReason: "STOP" }],
      })}\n\n`,
    ];
    fetchMock.mockResolvedValue(mockStreamingResponse(events));

    const result = await geminiChat({
      messages: [{ role: "user", content: "Say hello." }],
    });

    expect(result.content).toBe(plainText);
    expect(result.text).toBe(plainText);
  });

  it("discards frequencyPenalty and presencePenalty without error", async () => {
    const events = makeGeminiSseEvents(JSON.stringify({ ok: true }));
    fetchMock.mockResolvedValue(mockStreamingResponse(events));

    const result = await geminiChat({
      ...baseOptions,
      frequencyPenalty: 0.5,
      presencePenalty: 0.8,
    });

    expect(result.content).toEqual({ ok: true });

    // Verify they don't appear in the request body
    const body = JSON.parse(
      (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string,
    );
    expect(body.frequencyPenalty).toBeUndefined();
    expect(body.presencePenalty).toBeUndefined();
    expect(body.generationConfig.frequencyPenalty).toBeUndefined();
    expect(body.generationConfig.presencePenalty).toBeUndefined();
  });

  it("passes an AbortSignal to fetch (IdleTimeoutController)", async () => {
    const events = makeGeminiSseEvents(JSON.stringify({ ok: true }));
    fetchMock.mockResolvedValue(mockStreamingResponse(events));

    await geminiChat(baseOptions);

    const init = (fetchMock.mock.calls[0] as [string, RequestInit])[1];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("handles missing usageMetadata by defaulting to zeros", async () => {
    // Stream without usageMetadata
    const events = [
      `data: ${JSON.stringify({
        candidates: [{ content: { parts: [{ text: JSON.stringify({ ok: true }) }], role: "model" }, finishReason: "STOP" }],
      })}\n\n`,
    ];
    fetchMock.mockResolvedValue(mockStreamingResponse(events));

    const result = await geminiChat(baseOptions);

    expect(result.usage).toEqual({
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    });
  });

  describe("streaming accumulation", () => {
    it("accumulates text across multiple SSE chunks", async () => {
      const events = [
        `data: ${JSON.stringify({
          candidates: [{ content: { parts: [{ text: '{"he' }], role: "model" } }],
        })}\n\n`,
        `data: ${JSON.stringify({
          candidates: [{ content: { parts: [{ text: 'llo":"world"}' }], role: "model" }, finishReason: "STOP" }],
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
        })}\n\n`,
      ];

      fetchMock.mockResolvedValue(mockStreamingResponse(events));

      const result = await geminiChat(baseOptions);
      expect(result.content).toEqual({ hello: "world" });
      expect(result.usage).toEqual({
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
      });
    });

    it("retries on timeout then succeeds on second attempt", async () => {
      const events = makeGeminiSseEvents(JSON.stringify({ ok: true }));

      fetchMock
        .mockRejectedValueOnce(
          new DOMException("signal timed out", "TimeoutError"),
        )
        .mockResolvedValueOnce(mockStreamingResponse(events));

      const result = await geminiChat({
        ...baseOptions,
        maxRetries: 1,
      });

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(result.content).toEqual({ ok: true });
    });
  });
});
