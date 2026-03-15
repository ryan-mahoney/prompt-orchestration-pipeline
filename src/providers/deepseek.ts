// ── src/providers/deepseek.ts ──
// DeepSeek adapter — always streams internally, returns AdapterResponse.

import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  extractMessages,
  isRetryableError,
  sleep,
  stripMarkdownFences,
  tryParseJSON,
  createProviderError,
} from "./base.ts";
import { ProviderJsonParseError } from "./types.ts";
import type {
  DeepSeekOptions,
  AdapterResponse,
  ResponseFormatObject,
} from "./types.ts";
import {
  IdleTimeoutController,
  frameSse,
  parseOpenAiSse,
  accumulateStream,
} from "./stream-accumulator.ts";

const DEEPSEEK_API_URL = "https://api.deepseek.com/chat/completions";
const DEFAULT_MODEL = "deepseek-chat";
const DEFAULT_TEMPERATURE = 0.7;
const DEFAULT_RESPONSE_FORMAT = "json_object";
const DEFAULT_MAX_RETRIES = 3;

/**
 * Determines whether the response format indicates JSON mode.
 * Returns true for "json", "json_object", { type: "json_object" }, { json_schema: ... }.
 */
function isJsonMode(
  responseFormat: string | ResponseFormatObject | undefined,
): boolean {
  if (!responseFormat) return false;
  if (typeof responseFormat === "string") {
    return responseFormat === "json" || responseFormat === "json_object";
  }
  return (
    responseFormat.type === "json_object" ||
    responseFormat.json_schema != null
  );
}

export async function deepseekChat(
  options: DeepSeekOptions,
): Promise<AdapterResponse> {
  const {
    messages,
    model = DEFAULT_MODEL,
    temperature = DEFAULT_TEMPERATURE,
    maxTokens,
    responseFormat = DEFAULT_RESPONSE_FORMAT,
    topP,
    stop,
    maxRetries = DEFAULT_MAX_RETRIES,
    requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    frequencyPenalty,
    presencePenalty,
  } = options;
  const retryLimit = Number.isFinite(maxRetries)
    ? Math.max(0, Math.trunc(maxRetries))
    : DEFAULT_MAX_RETRIES;

  const jsonMode = isJsonMode(responseFormat);

  const { systemMsg, userMessages, assistantMessages } =
    extractMessages(messages);

  // Build the messages array in conversation order
  const apiMessages: Array<{ role: string; content: string }> = [];
  if (systemMsg) {
    apiMessages.push({ role: "system", content: systemMsg });
  }

  const nonSystemMessages = [...userMessages, ...assistantMessages].sort(
    (a, b) => {
      const aIdx = messages.indexOf(a);
      const bIdx = messages.indexOf(b);
      return aIdx - bIdx;
    },
  );
  for (const m of nonSystemMessages) {
    apiMessages.push({ role: m.role, content: m.content });
  }

  const apiKey = process.env["DEEPSEEK_API_KEY"];

  const body: Record<string, unknown> = {
    model,
    messages: apiMessages,
    temperature,
    stream: true,
  };

  if (maxTokens != null) body["max_tokens"] = maxTokens;
  if (topP != null) body["top_p"] = topP;
  if (stop != null) body["stop"] = stop;
  if (frequencyPenalty != null) body["frequency_penalty"] = frequencyPenalty;
  if (presencePenalty != null) body["presence_penalty"] = presencePenalty;
  // response_format is suppressed in stream mode

  let lastError: unknown;

  for (let attempt = 0; attempt <= retryLimit; attempt++) {
    try {
      const idle = new IdleTimeoutController(requestTimeoutMs);
      const response = await fetch(DEEPSEEK_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey ?? ""}`,
        },
        body: JSON.stringify(body),
        signal: idle.signal,
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
          `DeepSeek API error: ${response.status}`,
        );

        // 401 is never retried
        if (response.status === 401) {
          throw err;
        }

        throw err;
      }

      if (!response.body) {
        throw new Error("DeepSeek streaming response has no body");
      }

      const frames = frameSse(response.body);
      const deltas = parseOpenAiSse(frames);
      const accumulated = await accumulateStream(deltas, idle);

      const rawText = accumulated.text;
      const stripped = stripMarkdownFences(rawText);
      const parsed = tryParseJSON(stripped);

      // In JSON mode, if tryParseJSON returns a string, the response is unparseable
      if (jsonMode && typeof parsed === "string") {
        throw new ProviderJsonParseError(
          "deepseek",
          model,
          parsed.slice(0, 200),
        );
      }

      const usage = accumulated.usage ?? {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
      };

      return {
        content:
          typeof parsed === "string"
            ? parsed
            : (parsed as Record<string, unknown>),
        usage,
      };
    } catch (err) {
      lastError = err;

      if (!isRetryableError(err) || attempt >= retryLimit) {
        throw err;
      }

      // Exponential backoff: 2^attempt * 1000ms
      await sleep(Math.pow(2, attempt) * 1000);
    }
  }

  throw lastError;
}
