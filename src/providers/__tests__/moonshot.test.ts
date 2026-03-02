import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { moonshotChat } from "../moonshot.ts";
import { ProviderJsonParseError } from "../types.ts";
import type { MoonshotOptions } from "../types.ts";
import type { Mock } from "vitest";

function makeMoonshotResponse(
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

  it("returns parsed JSON content with usage", async () => {
    const jsonPayload = { result: "success", count: 42 };
    fetchMock.mockResolvedValue(
      mockFetchResponse(
        makeMoonshotResponse(JSON.stringify(jsonPayload), 15, 25),
      ),
    );

    const result = await moonshotChat(baseOptions);

    expect(result.content).toEqual(jsonPayload);
    expect(result.usage).toEqual({
      prompt_tokens: 15,
      completion_tokens: 25,
      total_tokens: 40,
    });
    expect(result.raw).toBeDefined();
  });

  it("includes thinking parameter in request body", async () => {
    const jsonPayload = { ok: true };
    fetchMock.mockResolvedValue(
      mockFetchResponse(makeMoonshotResponse(JSON.stringify(jsonPayload))),
    );

    await moonshotChat(baseOptions);

    const body = JSON.parse(
      (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string,
    );
    expect(body.thinking).toEqual({ type: "enabled" });
  });

  it("uses default model, maxTokens, and thinking values", async () => {
    const jsonPayload = { defaults: true };
    fetchMock.mockResolvedValue(
      mockFetchResponse(makeMoonshotResponse(JSON.stringify(jsonPayload))),
    );

    await moonshotChat({ messages: baseOptions.messages });

    const body = JSON.parse(
      (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string,
    );
    expect(body.model).toBe("kimi-k2.5");
    expect(body.max_tokens).toBe(32768);
    expect(body.thinking).toEqual({ type: "enabled" });
    expect(body.response_format).toEqual({ type: "json_object" });
  });

  it("throws before fetch when messages are empty", async () => {
    await expect(
      moonshotChat({ messages: [] }),
    ).rejects.toThrow(/at least one chat message/i);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends correct headers with Bearer token", async () => {
    const jsonPayload = { ok: true };
    fetchMock.mockResolvedValue(
      mockFetchResponse(makeMoonshotResponse(JSON.stringify(jsonPayload))),
    );

    await moonshotChat(baseOptions);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.moonshot.ai/v1/chat/completions");
    const headers = init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer test-moonshot-key");
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("always sends json_object response format", async () => {
    const jsonPayload = { ok: true };
    fetchMock.mockResolvedValue(
      mockFetchResponse(makeMoonshotResponse(JSON.stringify(jsonPayload))),
    );

    await moonshotChat(baseOptions);

    const body = JSON.parse(
      (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string,
    );
    expect(body.response_format).toEqual({ type: "json_object" });
  });

  it("does not include temperature, topP, frequencyPenalty, or presencePenalty in request body", async () => {
    const jsonPayload = { ok: true };
    fetchMock.mockResolvedValue(
      mockFetchResponse(makeMoonshotResponse(JSON.stringify(jsonPayload))),
    );

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
      // Second call: DeepSeek returns success
      fetchMock
        .mockResolvedValueOnce(mockFetchResponse(contentFilterError, 400))
        .mockResolvedValueOnce(
          mockFetchResponse({
            choices: [
              { message: { content: JSON.stringify(deepseekPayload) } },
            ],
            usage: {
              prompt_tokens: 5,
              completion_tokens: 10,
              total_tokens: 15,
            },
          }),
        );

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

      fetchMock
        .mockResolvedValueOnce(mockFetchResponse(contentFilterError, 400))
        .mockResolvedValueOnce(
          mockFetchResponse({
            choices: [
              { message: { content: JSON.stringify(deepseekPayload) } },
            ],
            usage: {
              prompt_tokens: 5,
              completion_tokens: 10,
              total_tokens: 15,
            },
          }),
        );

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
        mockFetchResponse(contentFilterError, 400),
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
      fetchMock
        .mockResolvedValueOnce(
          mockFetchResponse(
            { error: { message: "This content has HIGH RISK" } },
            400,
          ),
        )
        .mockResolvedValueOnce(
          mockFetchResponse({
            choices: [
              { message: { content: JSON.stringify(deepseekPayload) } },
            ],
            usage: {
              prompt_tokens: 5,
              completion_tokens: 10,
              total_tokens: 15,
            },
          }),
        );

      const result = await moonshotChat(baseOptions);
      expect(result.content).toEqual(deepseekPayload);
    });
  });

  describe("error handling", () => {
    it("throws immediately on 401 without retrying", async () => {
      fetchMock.mockResolvedValue(
        mockFetchResponse({ error: { message: "Unauthorized" } }, 401),
      );

      await expect(
        moonshotChat({ ...baseOptions, maxRetries: 3 }),
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
            makeMoonshotResponse(JSON.stringify(jsonPayload)),
          ),
        );

      const result = await moonshotChat({ ...baseOptions, maxRetries: 3 });

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(result.content).toEqual(jsonPayload);
    });

    it("does not retry ProviderJsonParseError", async () => {
      const nonJsonText = "This is plain text, not JSON at all.";
      fetchMock.mockResolvedValue(
        mockFetchResponse(makeMoonshotResponse(nonJsonText)),
      );

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
    const jsonPayload = { ok: true };
    fetchMock.mockResolvedValue(
      mockFetchResponse(makeMoonshotResponse(JSON.stringify(jsonPayload))),
    );

    await moonshotChat({ ...baseOptions, thinking: "disabled" });

    const body = JSON.parse(
      (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string,
    );
    expect(body.thinking).toEqual({ type: "disabled" });
  });

  it("handles markdown-fenced JSON responses", async () => {
    const fencedJson = '```json\n{"fenced": true}\n```';
    fetchMock.mockResolvedValue(
      mockFetchResponse(makeMoonshotResponse(fencedJson)),
    );

    const result = await moonshotChat(baseOptions);
    expect(result.content).toEqual({ fenced: true });
  });
});
