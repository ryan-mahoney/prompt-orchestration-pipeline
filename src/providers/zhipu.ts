// ── src/providers/zhipu.ts ──
// Z.ai OpenAI-compatible chat completions adapter.

import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  extractMessages,
  isRetryableError,
  sleep,
  stripMarkdownFences,
  tryParseJSON,
  createProviderError,
  ensureJsonResponseFormat,
} from "./base.ts";
import {
  IdleTimeoutController,
  frameSse,
  parseOpenAiSse,
  accumulateStream,
} from "./stream-accumulator.ts";
import { ProviderJsonParseError } from "./types.ts";
import type { ProviderOptions, AdapterResponse, ResponseFormatObject } from "./types.ts";

const ZAI_API_URL = "https://api.z.ai/api/paas/v4/chat/completions";
const DEFAULT_MODEL = "glm-5";
const DEFAULT_TEMPERATURE = 0.7;
const DEFAULT_MAX_TOKENS = 8192;
const DEFAULT_RESPONSE_FORMAT = "json";
const DEFAULT_MAX_RETRIES = 3;

/** Returns true when responseFormat indicates JSON output. */
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

/** Extracts a JSON schema object from responseFormat, if present. */
function extractJsonSchema(
  responseFormat: string | ResponseFormatObject | undefined,
): unknown | undefined {
  if (
    responseFormat &&
    typeof responseFormat === "object" &&
    responseFormat.json_schema != null
  ) {
    return responseFormat.json_schema;
  }
  return undefined;
}

export async function zaiChat(
  options: ProviderOptions,
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
    requestTimeoutMs,
  } = options;

  const jsonMode = isJsonMode(responseFormat);

  // Validate JSON response format
  ensureJsonResponseFormat(responseFormat, "zai");

  const { systemMsg, userMessages, assistantMessages } =
    extractMessages(messages);

  // Build system message with optional JSON schema injection
  const jsonSchema = extractJsonSchema(responseFormat);
  let systemText = systemMsg;
  if (jsonSchema) {
    const schemaStr = JSON.stringify(jsonSchema, null, 2);
    const schemaInstruction = `\n\nRespond with JSON matching this schema:\n${schemaStr}`;
    systemText = systemText ? systemText + schemaInstruction : schemaInstruction.trimStart();
  }

  // Build OpenAI-compatible messages array (preserve conversation order)
  const nonSystemMessages = [...userMessages, ...assistantMessages].sort(
    (a, b) => {
      const aIdx = messages.indexOf(a);
      const bIdx = messages.indexOf(b);
      return aIdx - bIdx;
    },
  );

  const chatMessages: Array<{ role: string; content: string }> = [];

  if (systemText) {
    chatMessages.push({ role: "system", content: systemText });
  }

  for (const m of nonSystemMessages) {
    chatMessages.push({ role: m.role, content: m.content });
  }

  const apiKey = process.env["ZAI_API_KEY"] ?? process.env["ZHIPU_API_KEY"];

  const body: Record<string, unknown> = {
    model,
    temperature,
    max_tokens: maxTokens,
    messages: chatMessages,
  };
  if (topP != null) {
    body["top_p"] = topP;
  }
  if (stop != null) {
    body["stop"] = stop;
  }

  // Add response_format for JSON mode (OpenAI-compatible format)
  if (jsonMode && !jsonSchema) {
    body["response_format"] = { type: "json_object" };
  }

  // Enable streaming
  body["stream"] = true;

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const idle = new IdleTimeoutController(requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS);
      const response = await fetch(ZAI_API_URL, {
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
          `Z.ai API error: ${response.status}`,
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

      // In JSON mode, if tryParseJSON returns a string, the response is unparseable
      if (jsonMode && typeof parsed === "string") {
        throw new ProviderJsonParseError(
          "zai",
          model,
          parsed.slice(0, 200),
        );
      }

      const usage = {
        prompt_tokens: accumulated.usage?.prompt_tokens ?? 0,
        completion_tokens: accumulated.usage?.completion_tokens ?? 0,
        total_tokens: accumulated.usage?.total_tokens ?? 0,
      };

      return {
        content: typeof parsed === "string" ? parsed : (parsed as Record<string, unknown>),
        text: rawText,
        usage,
        raw: accumulated,
      };
    } catch (err) {
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

export const zhipuChat = zaiChat;
