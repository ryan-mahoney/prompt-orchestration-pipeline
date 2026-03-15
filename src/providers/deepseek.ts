// ── src/providers/deepseek.ts ──
// DeepSeek adapter with streaming support via async generator.

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
  StreamingChunk,
  ResponseFormatObject,
} from "./types.ts";

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

/**
 * Builds the response_format payload for the DeepSeek API.
 * Returns undefined when streaming (response_format is suppressed).
 */
function buildResponseFormat(
  responseFormat: string | ResponseFormatObject | undefined,
  streaming: boolean,
): { type: string } | undefined {
  if (streaming) return undefined;
  if (!responseFormat) return undefined;
  if (isJsonMode(responseFormat)) {
    return { type: "json_object" };
  }
  return undefined;
}

/**
 * Parses SSE lines from a ReadableStream and yields StreamingChunk objects.
 */
async function* parseSSEStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<StreamingChunk> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      // Keep the last incomplete line in the buffer
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(":")) continue;
        if (!trimmed.startsWith("data:")) continue;

        const data = trimmed.slice(5).trim();
        if (data === "[DONE]") return;

        try {
          const parsed = JSON.parse(data) as {
            choices?: Array<{
              delta?: { content?: string };
            }>;
          };
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) {
            yield { content };
          }
        } catch {
          // Skip malformed SSE data lines
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export async function deepseekChat(
  options: DeepSeekOptions & { stream: true },
): Promise<AsyncGenerator<StreamingChunk>>;
export async function deepseekChat(
  options: DeepSeekOptions,
): Promise<AdapterResponse>;
export async function deepseekChat(
  options: DeepSeekOptions,
): Promise<AdapterResponse | AsyncGenerator<StreamingChunk>> {
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
    stream = false,
  } = options;
  const retryLimit = Number.isFinite(maxRetries)
    ? Math.max(0, Math.trunc(maxRetries))
    : DEFAULT_MAX_RETRIES;

  const jsonMode = !stream && isJsonMode(responseFormat);

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
    stream,
  };

  if (maxTokens != null) body["max_tokens"] = maxTokens;
  if (topP != null) body["top_p"] = topP;
  if (stop != null) body["stop"] = stop;
  if (frequencyPenalty != null) body["frequency_penalty"] = frequencyPenalty;
  if (presencePenalty != null) body["presence_penalty"] = presencePenalty;

  const responseFormatPayload = buildResponseFormat(responseFormat, stream);
  if (responseFormatPayload) {
    body["response_format"] = responseFormatPayload;
  }

  // Streaming mode: retry loop around the initial HTTP request
  if (stream) {
    let lastStreamError: unknown;

    for (let attempt = 0; attempt <= retryLimit; attempt++) {
      try {
        const signal = AbortSignal.timeout(requestTimeoutMs);
        const response = await fetch(DEEPSEEK_API_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey ?? ""}`,
          },
          body: JSON.stringify(body),
          signal,
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

        return parseSSEStream(response.body);
      } catch (err) {
        lastStreamError = err;

        if (!isRetryableError(err) || attempt >= retryLimit) {
          throw err;
        }

        // Exponential backoff: 2^attempt * 1000ms
        await sleep(Math.pow(2, attempt) * 1000);
      }
    }

    throw lastStreamError;
  }

  // Non-streaming mode: retry loop
  let lastError: unknown;

  for (let attempt = 0; attempt <= retryLimit; attempt++) {
    try {
      const signal = AbortSignal.timeout(requestTimeoutMs);
      const response = await fetch(DEEPSEEK_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey ?? ""}`,
        },
        body: JSON.stringify(body),
        signal,
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

      const data = (await response.json()) as {
        choices: Array<{
          message: { content: string };
        }>;
        usage?: {
          prompt_tokens: number;
          completion_tokens: number;
          total_tokens: number;
        };
      };

      const rawText = data.choices?.[0]?.message?.content ?? "";
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

      const usage = data.usage ?? {
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
        raw: data,
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
