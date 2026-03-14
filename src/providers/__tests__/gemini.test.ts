import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { geminiChat } from "../gemini.ts";
import { ProviderJsonModeError, ProviderJsonParseError } from "../types.ts";
import type { GeminiOptions } from "../types.ts";
import type { Mock } from "vitest";

function makeGeminiResponse(
  text: string,
  promptTokens = 10,
  candidatesTokens = 20,
  totalTokens = 30,
) {
  return {
    candidates: [
      {
        content: {
          parts: [{ text }],
          role: "model",
        },
      },
    ],
    usageMetadata: {
      promptTokenCount: promptTokens,
      candidatesTokenCount: candidatesTokens,
      totalTokenCount: totalTokens,
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
    fetchMock.mockResolvedValue(
      mockFetchResponse(
        makeGeminiResponse(JSON.stringify(jsonPayload), 15, 25, 40),
      ),
    );

    const result = await geminiChat(baseOptions);

    expect(result.content).toEqual(jsonPayload);
    expect(result.text).toBe(JSON.stringify(jsonPayload));
    expect(result.usage).toEqual({
      prompt_tokens: 15,
      completion_tokens: 25,
      total_tokens: 40,
    });
    expect(result.raw).toBeDefined();
  });

  it("includes safetySettings with BLOCK_NONE for all four categories", async () => {
    const jsonPayload = { ok: true };
    fetchMock.mockResolvedValue(
      mockFetchResponse(makeGeminiResponse(JSON.stringify(jsonPayload))),
    );

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
    const jsonPayload = { ok: true };
    fetchMock.mockResolvedValue(
      mockFetchResponse(makeGeminiResponse(JSON.stringify(jsonPayload))),
    );

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
    const jsonPayload = { name: "test" };
    fetchMock.mockResolvedValue(
      mockFetchResponse(makeGeminiResponse(JSON.stringify(jsonPayload))),
    );

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
    const jsonPayload = {};
    fetchMock.mockResolvedValue(
      mockFetchResponse(makeGeminiResponse(JSON.stringify(jsonPayload))),
    );

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
    const jsonPayload = { ok: true };
    fetchMock.mockResolvedValue(
      mockFetchResponse(
        makeGeminiResponse(JSON.stringify(jsonPayload), 100, 50, 150),
      ),
    );

    const result = await geminiChat(baseOptions);

    expect(result.usage).toEqual({
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150,
    });
  });

  it("uses default model gemini-2.5-flash and temperature 0.7", async () => {
    const jsonPayload = { ok: true };
    fetchMock.mockResolvedValue(
      mockFetchResponse(makeGeminiResponse(JSON.stringify(jsonPayload))),
    );

    await geminiChat(baseOptions);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/models/gemini-2.5-flash:generateContent");

    const body = JSON.parse(init.body as string);
    expect(body.generationConfig.temperature).toBe(0.7);
  });

  it("passes API key as query parameter", async () => {
    const jsonPayload = { ok: true };
    fetchMock.mockResolvedValue(
      mockFetchResponse(makeGeminiResponse(JSON.stringify(jsonPayload))),
    );

    await geminiChat(baseOptions);

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("key=test-key");
  });

  it("uses GEMINI_BASE_URL env var when set", async () => {
    process.env["GEMINI_BASE_URL"] = "https://custom.api.example.com/v1";
    const jsonPayload = { ok: true };
    fetchMock.mockResolvedValue(
      mockFetchResponse(makeGeminiResponse(JSON.stringify(jsonPayload))),
    );

    await geminiChat(baseOptions);

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url.startsWith("https://custom.api.example.com/v1/models/")).toBe(true);
  });

  it("throws immediately on 401 without retrying", async () => {
    fetchMock.mockResolvedValue(
      mockFetchResponse({ error: { message: "Unauthorized" } }, 401),
    );

    await expect(
      geminiChat({ ...baseOptions, maxRetries: 3 }),
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
        mockFetchResponse(makeGeminiResponse(JSON.stringify(jsonPayload))),
      );

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
    fetchMock.mockResolvedValue(
      mockFetchResponse(makeGeminiResponse(nonJsonText)),
    );

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
    fetchMock.mockResolvedValue(
      mockFetchResponse(makeGeminiResponse(plainText)),
    );

    const result = await geminiChat({
      messages: [{ role: "user", content: "Say hello." }],
    });

    expect(result.content).toBe(plainText);
    expect(result.text).toBe(plainText);
  });

  it("discards frequencyPenalty and presencePenalty without error", async () => {
    const jsonPayload = { ok: true };
    fetchMock.mockResolvedValue(
      mockFetchResponse(makeGeminiResponse(JSON.stringify(jsonPayload))),
    );

    const result = await geminiChat({
      ...baseOptions,
      frequencyPenalty: 0.5,
      presencePenalty: 0.8,
    });

    expect(result.content).toEqual(jsonPayload);

    // Verify they don't appear in the request body
    const body = JSON.parse(
      (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string,
    );
    expect(body.frequencyPenalty).toBeUndefined();
    expect(body.presencePenalty).toBeUndefined();
    expect(body.generationConfig.frequencyPenalty).toBeUndefined();
    expect(body.generationConfig.presencePenalty).toBeUndefined();
  });

  it("passes an AbortSignal to fetch", async () => {
    fetchMock.mockResolvedValue(
      mockFetchResponse(makeGeminiResponse(JSON.stringify({ ok: true }))),
    );

    await geminiChat(baseOptions);

    const init = (fetchMock.mock.calls[0] as [string, RequestInit])[1];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("uses custom requestTimeoutMs for the abort signal", async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    fetchMock.mockResolvedValue(
      mockFetchResponse(makeGeminiResponse(JSON.stringify({ ok: true }))),
    );

    await geminiChat({ ...baseOptions, requestTimeoutMs: 5000 });

    expect(timeoutSpy).toHaveBeenCalledWith(5000);
    timeoutSpy.mockRestore();
  });

  it("handles missing usageMetadata by defaulting to zeros", async () => {
    const jsonPayload = { ok: true };
    const responseWithoutUsage = {
      candidates: [
        { content: { parts: [{ text: JSON.stringify(jsonPayload) }] } },
      ],
    };
    fetchMock.mockResolvedValue(mockFetchResponse(responseWithoutUsage));

    const result = await geminiChat(baseOptions);

    expect(result.usage).toEqual({
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    });
  });
});
