// ── src/providers/base.ts ──
// Shared base utilities used by all provider adapters.

import { ProviderJsonModeError, ProviderMessagesError } from "./types.ts";
import type { ChatMessage, ExtractedMessages, ProviderError } from "./types.ts";

export const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;

const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
const RETRYABLE_ERROR_CODES = new Set([
  "ECONNRESET",
  "ENOTFOUND",
  "ETIMEDOUT",
  "ECONNREFUSED",
]);
const RETRYABLE_MESSAGE_PATTERN = /network|timeout|connection|socket|protocol|read ECONNRESET|fetch failed/i;

/**
 * Splits a messages array into system, user, and assistant parts.
 * Multiple user messages are joined with newlines into `userMsg`.
 */
export function extractMessages(messages: ChatMessage[]): ExtractedMessages {
  const userMessages: ChatMessage[] = [];
  const assistantMessages: ChatMessage[] = [];
  let systemMsg = "";

  for (const msg of messages) {
    switch (msg.role) {
      case "system":
        systemMsg = msg.content;
        break;
      case "user":
        userMessages.push(msg);
        break;
      case "assistant":
        assistantMessages.push(msg);
        break;
    }
  }

  const userMsg = userMessages.map((m) => m.content).join("\n");

  return { systemMsg, userMsg, userMessages, assistantMessages };
}

/** Validates that a chat request includes at least one non-empty message. */
export function ensureMessagesPresent(
  messages: ChatMessage[] | undefined,
  providerName: string,
): asserts messages is ChatMessage[] {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new ProviderMessagesError(providerName);
  }

  const hasContent = messages.some((msg) => msg.content.trim().length > 0);
  if (!hasContent) {
    throw new ProviderMessagesError(
      providerName,
      `Provider "${providerName}" requires at least one non-empty chat message`,
    );
  }
}

/** Returns true for transient/retryable errors (network failures, 429, 5xx). */
export function isRetryableError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;

  // ProviderJsonParseError is never retryable
  if (err.name === "ProviderJsonParseError") return false;

  // Fetch/AbortSignal timeout errors are always retryable
  if (err.name === "TimeoutError") return true;

  // Check HTTP status codes
  const status = (err as { status?: number }).status;
  if (typeof status === "number") {
    return RETRYABLE_STATUS_CODES.has(status);
  }

  // Check network error codes
  const code = (err as { code?: string }).code;
  if (typeof code === "string") {
    return RETRYABLE_ERROR_CODES.has(code);
  }

  if (RETRYABLE_MESSAGE_PATTERN.test(err.message)) return true;

  // Evaluate .cause (e.g. undici wraps root network errors as cause)
  const cause = (err as { cause?: unknown }).cause;
  if (cause) return isRetryableError(cause);

  return false;
}

/** Returns a promise that resolves after `ms` milliseconds. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Removes markdown code fences (```json ... ``` or ```lang ... ```) from text. */
export function stripMarkdownFences(text: string): string {
  return text.replace(/^```(?:\w*)\n?([\s\S]*?)```$/g, "$1").trim();
}

/**
 * Attempts to parse text as JSON with progressive fallback:
 * 1. Direct JSON.parse
 * 2. Strip markdown fences, then JSON.parse
 * 3. Extract first `{...}` block and JSON.parse
 * Returns the parsed value on success, or the original text as a string on failure.
 * Never throws.
 */
export function tryParseJSON(text: string): unknown {
  // 1. Direct parse
  try {
    return JSON.parse(text);
  } catch {
    // continue
  }

  // 2. Strip markdown fences
  const stripped = stripMarkdownFences(text);
  if (stripped !== text) {
    try {
      return JSON.parse(stripped);
    } catch {
      // continue
    }
  }

  // 3. Extract first {...} block
  const braceStart = text.indexOf("{");
  const braceEnd = text.lastIndexOf("}");
  if (braceStart !== -1 && braceEnd > braceStart) {
    try {
      return JSON.parse(text.slice(braceStart, braceEnd + 1));
    } catch {
      // continue
    }
  }

  const bracketStart = text.indexOf("[");
  const bracketEnd = text.lastIndexOf("]");
  if (bracketStart !== -1 && bracketEnd > bracketStart) {
    try {
      return JSON.parse(text.slice(bracketStart, bracketEnd + 1));
    } catch {
      // continue
    }
  }

  // Total failure — return original text
  return text;
}

/** Extracts a human-readable message from a provider error body. */
function extractErrorMessage(errorBody: unknown): string | undefined {
  if (!errorBody || typeof errorBody !== "object") return undefined;

  const body = errorBody as Record<string, unknown>;

  // Top-level message (e.g. { message: "..." })
  if ("message" in body && body.message) {
    return String(body.message);
  }

  // Nested error object (e.g. { error: { message: "..." } }) — OpenAI/Moonshot/DeepSeek format
  if (
    "error" in body &&
    body.error &&
    typeof body.error === "object" &&
    "message" in (body.error as Record<string, unknown>)
  ) {
    return String((body.error as Record<string, unknown>).message);
  }

  return undefined;
}

/** Creates an Error with HTTP status metadata attached. */
export function createProviderError(
  status: number,
  errorBody: unknown,
  fallbackMessage: string,
): ProviderError {
  const message = extractErrorMessage(errorBody) ?? fallbackMessage;

  const error = new Error(message) as ProviderError;
  error.status = status;
  error.code = `HTTP_${status}`;
  error.details = errorBody;
  return error;
}

/**
 * Validates that `responseFormat` indicates a JSON mode.
 * Accepts: "json", "json_object", { type: "json_object" }, { json_schema: ... }.
 * Throws ProviderJsonModeError for undefined, null, "", "text", or other invalid values.
 */
export function ensureJsonResponseFormat(
  responseFormat: unknown,
  providerName: string,
): void {
  if (responseFormat == null || responseFormat === "") {
    throw new ProviderJsonModeError(providerName);
  }

  if (typeof responseFormat === "string") {
    if (responseFormat === "json" || responseFormat === "json_object") {
      return;
    }
    throw new ProviderJsonModeError(providerName);
  }

  if (typeof responseFormat === "object") {
    const obj = responseFormat as Record<string, unknown>;
    if (obj.type === "json_object" || obj.json_schema != null) {
      return;
    }
    throw new ProviderJsonModeError(providerName);
  }

  throw new ProviderJsonModeError(providerName);
}
