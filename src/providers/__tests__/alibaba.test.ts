import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { alibabaChat } from "../alibaba.ts";
import { ProviderJsonParseError } from "../types.ts";
import type { AlibabaOptions } from "../types.ts";
import type { Mock } from "vitest";

function makeAlibabaResponse(
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
    fetchMock.mockResolvedValue(
      mockFetchResponse(
        makeAlibabaResponse(JSON.stringify(jsonPayload), 15, 25),
      ),
    );

    const result = await alibabaChat(baseOptions);

    expect(result.content).toEqual(jsonPayload);
    expect(result.usage).toEqual({
      prompt_tokens: 15,
      completion_tokens: 25,
      total_tokens: 40,
    });
    expect(result.raw).toBeDefined();
  });

  it("throws ProviderJsonParseError on invalid JSON when responseFormat is json_object", async () => {
    const nonJsonText = "This is plain text, not JSON at all.";
    fetchMock.mockResolvedValue(
      mockFetchResponse(makeAlibabaResponse(nonJsonText)),
    );

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
    fetchMock
      .mockResolvedValueOnce(
        mockFetchResponse({ error: { message: "Server error" } }, 500),
      )
      .mockResolvedValueOnce(
        mockFetchResponse({ error: { message: "Server error" } }, 500),
      )
      .mockResolvedValueOnce(
        mockFetchResponse(
          makeAlibabaResponse(JSON.stringify(jsonPayload)),
        ),
      );

    const result = await alibabaChat({ ...baseOptions, maxRetries: 3 });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.content).toEqual(jsonPayload);
  });

  it("does NOT retry on HTTP 401", async () => {
    fetchMock.mockResolvedValue(
      mockFetchResponse({ error: { message: "Unauthorized" } }, 401),
    );

    await expect(
      alibabaChat({ ...baseOptions, maxRetries: 3 }),
    ).rejects.toMatchObject({ status: 401, message: "Unauthorized" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("uses ALIBABA_BASE_URL env var when set", async () => {
    process.env["ALIBABA_BASE_URL"] = "https://custom.api.example.com";
    const jsonPayload = { ok: true };
    fetchMock.mockResolvedValue(
      mockFetchResponse(makeAlibabaResponse(JSON.stringify(jsonPayload))),
    );

    await alibabaChat(baseOptions);

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://custom.api.example.com/chat/completions",
    );
  });

  it("passes frequencyPenalty and presencePenalty in request body", async () => {
    const jsonPayload = { ok: true };
    fetchMock.mockResolvedValue(
      mockFetchResponse(makeAlibabaResponse(JSON.stringify(jsonPayload))),
    );

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

  it("passes an AbortSignal to fetch", async () => {
    fetchMock.mockResolvedValue(
      mockFetchResponse(makeAlibabaResponse(JSON.stringify({ ok: true }))),
    );

    await alibabaChat(baseOptions);

    const init = (fetchMock.mock.calls[0] as [string, RequestInit])[1];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("uses custom requestTimeoutMs for the abort signal", async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    fetchMock.mockResolvedValue(
      mockFetchResponse(makeAlibabaResponse(JSON.stringify({ ok: true }))),
    );

    await alibabaChat({ ...baseOptions, requestTimeoutMs: 5000 });

    expect(timeoutSpy).toHaveBeenCalledWith(5000);
    timeoutSpy.mockRestore();
  });

  it("sends enable_thinking true by default", async () => {
    fetchMock.mockResolvedValue(
      mockFetchResponse(makeAlibabaResponse(JSON.stringify({ ok: true }))),
    );

    await alibabaChat(baseOptions);

    const body = JSON.parse(
      (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string,
    );
    expect(body.enable_thinking).toBe(true);
  });

  it("sends enable_thinking false when thinking is disabled", async () => {
    fetchMock.mockResolvedValue(
      mockFetchResponse(makeAlibabaResponse(JSON.stringify({ ok: true }))),
    );

    await alibabaChat({ ...baseOptions, thinking: "disabled" });

    const body = JSON.parse(
      (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string,
    );
    expect(body.enable_thinking).toBe(false);
  });
});
