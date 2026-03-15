import { describe, expect, it } from "vitest";
import {
  createProviderError,
  DEFAULT_REQUEST_TIMEOUT_MS,
  ensureJsonResponseFormat,
  extractMessages,
  isRetryableError,
  sleep,
  stripMarkdownFences,
  tryParseJSON,
} from "../base.ts";
import {
  ProviderJsonModeError,
  ProviderJsonParseError,
} from "../types.ts";
import type { ChatMessage } from "../types.ts";

describe("extractMessages", () => {
  it("splits system, user, and assistant messages correctly", () => {
    const messages: ChatMessage[] = [
      { role: "system", content: "You are helpful." },
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there" },
    ];
    const result = extractMessages(messages);
    expect(result.systemMsg).toBe("You are helpful.");
    expect(result.userMsg).toBe("Hello");
    expect(result.userMessages).toEqual([{ role: "user", content: "Hello" }]);
    expect(result.assistantMessages).toEqual([
      { role: "assistant", content: "Hi there" },
    ]);
  });

  it("handles empty array", () => {
    const result = extractMessages([]);
    expect(result.systemMsg).toBe("");
    expect(result.userMsg).toBe("");
    expect(result.userMessages).toEqual([]);
    expect(result.assistantMessages).toEqual([]);
  });

  it("joins multiple user messages into userMsg", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "First question" },
      { role: "user", content: "Second question" },
      { role: "user", content: "Third question" },
    ];
    const result = extractMessages(messages);
    expect(result.userMsg).toBe(
      "First question\nSecond question\nThird question",
    );
    expect(result.userMessages).toHaveLength(3);
  });

  it("uses the last system message", () => {
    const messages: ChatMessage[] = [
      { role: "system", content: "First system" },
      { role: "user", content: "Hello" },
      { role: "system", content: "Second system" },
    ];
    const result = extractMessages(messages);
    expect(result.systemMsg).toBe("Second system");
  });
});

describe("isRetryableError", () => {
  it("returns true for HTTP 429", () => {
    const err = Object.assign(new Error("rate limited"), { status: 429 });
    expect(isRetryableError(err)).toBe(true);
  });

  it("returns true for HTTP 500", () => {
    const err = Object.assign(new Error("internal"), { status: 500 });
    expect(isRetryableError(err)).toBe(true);
  });

  it("returns true for HTTP 502", () => {
    const err = Object.assign(new Error("bad gateway"), { status: 502 });
    expect(isRetryableError(err)).toBe(true);
  });

  it("returns true for HTTP 503", () => {
    const err = Object.assign(new Error("unavailable"), { status: 503 });
    expect(isRetryableError(err)).toBe(true);
  });

  it("returns true for HTTP 504", () => {
    const err = Object.assign(new Error("timeout"), { status: 504 });
    expect(isRetryableError(err)).toBe(true);
  });

  it("returns true for ECONNRESET", () => {
    const err = Object.assign(new Error("connection reset"), {
      code: "ECONNRESET",
    });
    expect(isRetryableError(err)).toBe(true);
  });

  it("returns true for ENOTFOUND", () => {
    const err = Object.assign(new Error("not found"), { code: "ENOTFOUND" });
    expect(isRetryableError(err)).toBe(true);
  });

  it("returns true for ETIMEDOUT", () => {
    const err = Object.assign(new Error("timed out"), { code: "ETIMEDOUT" });
    expect(isRetryableError(err)).toBe(true);
  });

  it("returns true for ECONNREFUSED", () => {
    const err = Object.assign(new Error("refused"), { code: "ECONNREFUSED" });
    expect(isRetryableError(err)).toBe(true);
  });

  it("returns false for HTTP 401", () => {
    const err = Object.assign(new Error("unauthorized"), { status: 401 });
    expect(isRetryableError(err)).toBe(false);
  });

  it("returns false for HTTP 400", () => {
    const err = Object.assign(new Error("bad request"), { status: 400 });
    expect(isRetryableError(err)).toBe(false);
  });

  it("returns false for ProviderJsonParseError", () => {
    const err = new ProviderJsonParseError("openai", "gpt-5", "bad json");
    expect(isRetryableError(err)).toBe(false);
  });

  it("returns false for non-Error values", () => {
    expect(isRetryableError("string error")).toBe(false);
    expect(isRetryableError(null)).toBe(false);
    expect(isRetryableError(undefined)).toBe(false);
    expect(isRetryableError(42)).toBe(false);
  });

  it("returns false for plain Error without status or code", () => {
    expect(isRetryableError(new Error("generic"))).toBe(false);
  });

  it("returns true for TypeError with 'fetch failed' message", () => {
    expect(isRetryableError(new TypeError("fetch failed"))).toBe(true);
  });

  it("returns true when cause has a retryable error code", () => {
    const err = new TypeError("unknown error", {
      cause: Object.assign(new Error("connection refused"), {
        code: "ECONNREFUSED",
      }),
    });
    expect(isRetryableError(err)).toBe(true);
  });

  it("returns false when both error and cause are non-retryable", () => {
    const err = new TypeError("unknown error", {
      cause: new Error("something else"),
    });
    expect(isRetryableError(err)).toBe(false);
  });

  it("returns true for TimeoutError (AbortSignal/fetch timeout)", () => {
    const err = new DOMException("signal timed out", "TimeoutError");
    expect(err.name).toBe("TimeoutError");
    expect(isRetryableError(err)).toBe(true);
  });
});

describe("DEFAULT_REQUEST_TIMEOUT_MS", () => {
  it("is 120 000 ms", () => {
    expect(DEFAULT_REQUEST_TIMEOUT_MS).toBe(120_000);
  });
});

describe("sleep", () => {
  it("resolves after the specified time", async () => {
    const start = Date.now();
    await sleep(50);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(40);
  });
});

describe("stripMarkdownFences", () => {
  it("removes ```json ... ``` fences", () => {
    const input = '```json\n{"key": "value"}\n```';
    expect(stripMarkdownFences(input)).toBe('{"key": "value"}');
  });

  it("removes ```lang ... ``` fences for any language", () => {
    const input = "```typescript\nconst x = 1;\n```";
    expect(stripMarkdownFences(input)).toBe("const x = 1;");
  });

  it("removes bare ``` fences without a language tag", () => {
    const input = '```\n{"a": 1}\n```';
    expect(stripMarkdownFences(input)).toBe('{"a": 1}');
  });

  it("preserves text without fences", () => {
    const input = '{"key": "value"}';
    expect(stripMarkdownFences(input)).toBe('{"key": "value"}');
  });

  it("preserves text with backticks that are not fences", () => {
    const input = "Use `code` inline";
    expect(stripMarkdownFences(input)).toBe("Use `code` inline");
  });
});

describe("tryParseJSON", () => {
  it("parses valid JSON", () => {
    expect(tryParseJSON('{"key": "value"}')).toEqual({ key: "value" });
  });

  it("parses JSON arrays", () => {
    expect(tryParseJSON("[1, 2, 3]")).toEqual([1, 2, 3]);
  });

  it("parses fenced JSON", () => {
    const input = '```json\n{"key": "value"}\n```';
    expect(tryParseJSON(input)).toEqual({ key: "value" });
  });

  it("extracts first {...} from surrounding text", () => {
    const input = 'Here is the result: {"key": "value"} and more text';
    expect(tryParseJSON(input)).toEqual({ key: "value" });
  });

  it("returns original text on total failure", () => {
    const input = "this is not json at all";
    const result = tryParseJSON(input);
    expect(result).toBe(input);
    expect(typeof result).toBe("string");
  });

  it("never throws", () => {
    expect(() => tryParseJSON("")).not.toThrow();
    expect(() => tryParseJSON("{invalid")).not.toThrow();
    expect(() => tryParseJSON("{{{}}}")).not.toThrow();
  });

  it("parses JSON with leading/trailing whitespace", () => {
    expect(tryParseJSON('  {"key": 1}  ')).toEqual({ key: 1 });
  });
});

describe("ensureJsonResponseFormat", () => {
  it('accepts "json"', () => {
    expect(() => ensureJsonResponseFormat("json", "test")).not.toThrow();
  });

  it('accepts "json_object"', () => {
    expect(() => ensureJsonResponseFormat("json_object", "test")).not.toThrow();
  });

  it('accepts { type: "json_object" }', () => {
    expect(() =>
      ensureJsonResponseFormat({ type: "json_object" }, "test"),
    ).not.toThrow();
  });

  it("accepts { json_schema: {} }", () => {
    expect(() =>
      ensureJsonResponseFormat({ json_schema: {} }, "test"),
    ).not.toThrow();
  });

  it("throws ProviderJsonModeError for undefined", () => {
    expect(() => ensureJsonResponseFormat(undefined, "test")).toThrow(
      ProviderJsonModeError,
    );
  });

  it("throws ProviderJsonModeError for null", () => {
    expect(() => ensureJsonResponseFormat(null, "test")).toThrow(
      ProviderJsonModeError,
    );
  });

  it('throws ProviderJsonModeError for ""', () => {
    expect(() => ensureJsonResponseFormat("", "test")).toThrow(
      ProviderJsonModeError,
    );
  });

  it('throws ProviderJsonModeError for "text"', () => {
    expect(() => ensureJsonResponseFormat("text", "test")).toThrow(
      ProviderJsonModeError,
    );
  });

  it("sets provider on thrown error", () => {
    try {
      ensureJsonResponseFormat(undefined, "anthropic");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderJsonModeError);
      expect((err as ProviderJsonModeError).provider).toBe("anthropic");
    }
  });
});

describe("createProviderError", () => {
  it("returns an Error with status, code, and details", () => {
    const err = createProviderError(500, { message: "server error" }, "fallback");
    expect(err).toBeInstanceOf(Error);
    expect(err.status).toBe(500);
    expect(err.code).toBe("HTTP_500");
    expect(err.details).toEqual({ message: "server error" });
  });

  it("uses message from errorBody when available", () => {
    const err = createProviderError(
      400,
      { message: "bad request body" },
      "fallback msg",
    );
    expect(err.message).toBe("bad request body");
  });

  it("uses fallback message when errorBody has no message", () => {
    const err = createProviderError(502, { error: "bad gateway" }, "fallback msg");
    expect(err.message).toBe("fallback msg");
  });

  it("uses fallback message when errorBody is null", () => {
    const err = createProviderError(503, null, "service unavailable");
    expect(err.message).toBe("service unavailable");
  });

  it("uses fallback message when errorBody is a string", () => {
    const err = createProviderError(504, "timeout", "gateway timeout");
    expect(err.message).toBe("gateway timeout");
  });
});
