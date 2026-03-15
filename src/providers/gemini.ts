// ── src/providers/gemini.ts ──
// Google Gemini GenerateContent adapter.

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
import { IdleTimeoutController, parseGeminiSse, accumulateStream } from "./stream-accumulator.ts";
import { ProviderJsonParseError } from "./types.ts";
import type {
  GeminiOptions,
  AdapterResponse,
  ResponseFormatObject,
} from "./types.ts";

const DEFAULT_MODEL = "gemini-2.5-flash";
const DEFAULT_TEMPERATURE = 0.7;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_URL =
  "https://generativelanguage.googleapis.com/v1beta";

/** All four Gemini safety categories, each set to BLOCK_NONE. */
const SAFETY_SETTINGS = [
  { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
];

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
 * Extracts a JSON schema object from the responseFormat, if present.
 */
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

export async function geminiChat(
  options: GeminiOptions,
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
    // Gemini does not support these — destructure and discard
    frequencyPenalty: _frequencyPenalty,
    presencePenalty: _presencePenalty,
  } = options;

  const jsonMode = isJsonMode(responseFormat);

  // Validate JSON response format if one was specified
  if (responseFormat) {
    ensureJsonResponseFormat(responseFormat, "gemini");
  }

  const { systemMsg, userMessages, assistantMessages } =
    extractMessages(messages);

  // Build Gemini contents array (non-system messages in conversation order)
  const nonSystemMessages = [...userMessages, ...assistantMessages].sort(
    (a, b) => {
      const aIdx = messages.indexOf(a);
      const bIdx = messages.indexOf(b);
      return aIdx - bIdx;
    },
  );

  const contents = nonSystemMessages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  // Build system instruction, optionally injecting JSON schema
  const jsonSchema = extractJsonSchema(responseFormat);
  let systemText = systemMsg;
  if (jsonSchema) {
    const schemaStr = JSON.stringify(jsonSchema, null, 2);
    const schemaInstruction = `\n\nRespond with JSON matching this schema:\n${schemaStr}`;
    systemText = systemText ? systemText + schemaInstruction : schemaInstruction.trimStart();
  }

  const systemInstruction = systemText
    ? { parts: [{ text: systemText }] }
    : undefined;

  // Build generationConfig
  const generationConfig: Record<string, unknown> = { temperature };
  if (maxTokens != null) generationConfig["maxOutputTokens"] = maxTokens;
  if (topP != null) generationConfig["topP"] = topP;
  if (stop != null) generationConfig["stopSequences"] = Array.isArray(stop) ? stop : [stop];
  if (jsonMode) generationConfig["responseMimeType"] = "application/json";

  const baseUrl =
    process.env["GEMINI_BASE_URL"] ?? DEFAULT_BASE_URL;
  const apiKey = process.env["GEMINI_API_KEY"] ?? "";
  const url = `${baseUrl}/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`;

  const body: Record<string, unknown> = {
    contents,
    safetySettings: SAFETY_SETTINGS,
    generationConfig,
  };

  if (systemInstruction) {
    body["systemInstruction"] = systemInstruction;
  }

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const idle = new IdleTimeoutController(requestTimeoutMs);
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
          `Gemini API error: ${response.status}`,
        );

        // 401 is never retried
        if (response.status === 401) {
          throw err;
        }

        throw err;
      }

      const deltas = parseGeminiSse(response.body!);
      const { text: rawText, usage: streamUsage } = await accumulateStream(deltas, idle);

      const stripped = stripMarkdownFences(rawText);
      const parsed = tryParseJSON(stripped);

      // In JSON mode, if tryParseJSON returns a string, the response is unparseable
      if (jsonMode && typeof parsed === "string") {
        throw new ProviderJsonParseError(
          "gemini",
          model,
          parsed.slice(0, 200),
        );
      }

      const usage = streamUsage ?? {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
      };

      return {
        content: typeof parsed === "string" ? parsed : (parsed as Record<string, unknown>),
        text: rawText,
        usage,
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
