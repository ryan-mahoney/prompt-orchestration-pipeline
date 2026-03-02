// ── src/providers/anthropic.ts ──
// Anthropic Messages API adapter.

import {
  extractMessages,
  isRetryableError,
  sleep,
  stripMarkdownFences,
  tryParseJSON,
  createProviderError,
  ensureJsonResponseFormat,
} from "./base.ts";
import { ProviderJsonParseError } from "./types.ts";
import type { AnthropicOptions, AdapterResponse } from "./types.ts";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_MODEL = "claude-3-sonnet";
const DEFAULT_TEMPERATURE = 0.7;
const DEFAULT_MAX_TOKENS = 8192;
const DEFAULT_RESPONSE_FORMAT = "json";
const DEFAULT_MAX_RETRIES = 3;

export async function anthropicChat(
  options: AnthropicOptions,
): Promise<AdapterResponse> {
  const {
    messages,
    model = DEFAULT_MODEL,
    temperature = DEFAULT_TEMPERATURE,
    maxTokens = DEFAULT_MAX_TOKENS,
    responseFormat = DEFAULT_RESPONSE_FORMAT,
    topP,
    stop,
    maxRetries = DEFAULT_MAX_RETRIES,
  } = options;

  // Validate JSON response format — if this throws, we are not in JSON mode
  ensureJsonResponseFormat(responseFormat, "anthropic");

  const { systemMsg, userMessages, assistantMessages } =
    extractMessages(messages);

  // Build the Anthropic messages array (non-system messages in conversation order)
  const anthropicMessages = [...userMessages, ...assistantMessages]
    .sort((a, b) => {
      const aIdx = messages.indexOf(a);
      const bIdx = messages.indexOf(b);
      return aIdx - bIdx;
    })
    .map((m) => ({ role: m.role, content: m.content }));

  const apiKey = process.env["ANTHROPIC_API_KEY"];

  const body: Record<string, unknown> = {
    model,
    max_tokens: maxTokens,
    temperature,
    messages: anthropicMessages,
  };

  if (systemMsg) {
    body["system"] = systemMsg;
  }
  if (topP != null) {
    body["top_p"] = topP;
  }
  if (stop != null) {
    body["stop_sequences"] = Array.isArray(stop) ? stop : [stop];
  }

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(ANTHROPIC_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "anthropic-version": ANTHROPIC_VERSION,
          "x-api-key": apiKey ?? "",
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        let errorBody: unknown;
        try {
          errorBody = await response.json();
        } catch {
          errorBody = await response.text();
        }

        const err = createProviderError(
          response.status,
          errorBody,
          `Anthropic API error: ${response.status}`,
        );

        // 401 is never retried
        if (response.status === 401) {
          throw err;
        }

        throw err;
      }

      const data = (await response.json()) as {
        content: Array<{ type: string; text: string }>;
        usage: { input_tokens: number; output_tokens: number };
      };

      const rawText =
        data.content
          .filter((block) => block.type === "text")
          .map((block) => block.text)
          .join("") || "";

      const stripped = stripMarkdownFences(rawText);
      const parsed = tryParseJSON(stripped);

      // In JSON mode, if tryParseJSON returns a string, the response is unparseable JSON
      if (typeof parsed === "string") {
        throw new ProviderJsonParseError(
          "anthropic",
          model,
          parsed.slice(0, 200),
        );
      }

      const usage = {
        prompt_tokens: data.usage.input_tokens,
        completion_tokens: data.usage.output_tokens,
        total_tokens: data.usage.input_tokens + data.usage.output_tokens,
      };

      return {
        content: parsed as Record<string, unknown>,
        text: rawText,
        usage,
        raw: data,
      };
    } catch (err) {
      lastError = err;

      // Never retry 401 or non-retryable errors
      if (!isRetryableError(err) || attempt >= maxRetries) {
        throw err;
      }

      // Exponential backoff: 2^attempt * 1000ms
      await sleep(Math.pow(2, attempt) * 1000);
    }
  }

  throw lastError;
}
