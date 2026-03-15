// ── src/providers/alibaba.ts ──
// Alibaba (DashScope) adapter using OpenAI-compatible chat completions API.

import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  extractMessages,
  ensureMessagesPresent,
  ensureJsonResponseFormat,
  isRetryableError,
  sleep,
  stripMarkdownFences,
  tryParseJSON,
  createProviderError,
} from "./base.ts";
import {
  IdleTimeoutController,
  frameSse,
  parseOpenAiSse,
  accumulateStream,
} from "./stream-accumulator.ts";
import { ProviderJsonParseError } from "./types.ts";
import type {
  AlibabaOptions,
  AdapterResponse,
  ResponseFormatObject,
} from "./types.ts";

const DEFAULT_MODEL = "qwen-plus";
const DEFAULT_TEMPERATURE = 0.7;
const DEFAULT_THINKING: "enabled" | "disabled" = "enabled";
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
 * Checks whether an error indicates response_format is unsupported in
 * streaming mode.
 */
function isResponseFormatStreamError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return msg.includes("response_format") && msg.includes("stream");
}

/**
 * Performs a non-streaming fetch and returns the parsed AdapterResponse.
 */
async function fetchNonStreaming(
  endpoint: string,
  apiKey: string,
  body: Record<string, unknown>,
  requestTimeoutMs: number,
  jsonMode: boolean,
  model: string,
): Promise<AdapterResponse> {
  const nonStreamBody = { ...body };
  delete nonStreamBody["stream"];
  delete nonStreamBody["stream_options"];

  const signal = AbortSignal.timeout(requestTimeoutMs);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(nonStreamBody),
    signal,
  });

  if (!response.ok) {
    let errorBody: unknown;
    try {
      errorBody = await response.json();
    } catch {
      errorBody = await response.text();
    }
    throw createProviderError(
      response.status,
      errorBody,
      `Alibaba API error: ${response.status}`,
    );
  }

  const data = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
    usage?: {
      prompt_tokens: number;
      completion_tokens: number;
      total_tokens: number;
    };
  };

  return parseResponseData(data, jsonMode, model);
}

/**
 * Parses the standard OpenAI-compatible response shape into an
 * AdapterResponse.
 */
function parseResponseData(
  data: {
    choices: Array<{ message: { content: string } }>;
    usage?: {
      prompt_tokens: number;
      completion_tokens: number;
      total_tokens: number;
    };
  },
  jsonMode: boolean,
  model: string,
): AdapterResponse {
  const rawText = data.choices?.[0]?.message?.content ?? "";
  const stripped = stripMarkdownFences(rawText);
  const parsed = tryParseJSON(stripped);

  if (jsonMode && typeof parsed === "string") {
    throw new ProviderJsonParseError(
      "alibaba",
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
    text: rawText,
    usage,
    raw: data,
  };
}

export async function alibabaChat(
  options: AlibabaOptions,
): Promise<AdapterResponse> {
  const {
    messages,
    model = DEFAULT_MODEL,
    temperature = DEFAULT_TEMPERATURE,
    maxTokens,
    responseFormat,
    topP,
    stop,
    maxRetries = DEFAULT_MAX_RETRIES,
    requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    frequencyPenalty,
    presencePenalty,
    thinking = DEFAULT_THINKING,
  } = options;

  ensureMessagesPresent(messages, "alibaba");

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

  const apiKey = process.env["ALIBABA_API_KEY"] ?? "";

  const endpoint = `${process.env["ALIBABA_BASE_URL"] ?? "https://dashscope-us.aliyuncs.com/compatible-mode/v1"}/chat/completions`;

  const body: Record<string, unknown> = {
    model,
    messages: apiMessages,
    temperature,
    stream: true,
    stream_options: { include_usage: true },
  };

  if (maxTokens != null) body["max_tokens"] = maxTokens;
  if (topP != null) body["top_p"] = topP;
  if (stop != null) body["stop"] = stop;
  if (frequencyPenalty != null) body["frequency_penalty"] = frequencyPenalty;
  if (presencePenalty != null) body["presence_penalty"] = presencePenalty;
  body["enable_thinking"] = thinking === "enabled";

  if (jsonMode) {
    ensureJsonResponseFormat(responseFormat, "alibaba");
    body["response_format"] = { type: "json_object" };
  }

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const idle = new IdleTimeoutController(requestTimeoutMs);
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
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
          `Alibaba API error: ${response.status}`,
        );

        // 401 is never retried
        if (response.status === 401) {
          throw err;
        }

        throw err;
      }

      const frames = frameSse(response.body!);
      const deltas = parseOpenAiSse(frames);
      const accumulated = await accumulateStream(deltas, idle);

      const rawText = accumulated.text;
      const stripped = stripMarkdownFences(rawText);
      const parsed = tryParseJSON(stripped);

      if (jsonMode && typeof parsed === "string") {
        throw new ProviderJsonParseError(
          "alibaba",
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
        text: rawText,
        usage,
        raw: accumulated,
      };
    } catch (err) {
      // Fallback: if response_format is unsupported in stream mode,
      // retry this attempt without streaming.
      if (isResponseFormatStreamError(err)) {
        return fetchNonStreaming(
          endpoint,
          apiKey,
          body,
          requestTimeoutMs,
          jsonMode,
          model,
        );
      }

      lastError = err;

      if (!isRetryableError(err) || attempt >= maxRetries) {
        throw err;
      }

      // Exponential backoff: 2^attempt * 1000ms
      await sleep(Math.pow(2, attempt) * 1000);
    }
  }

  throw lastError;
}
