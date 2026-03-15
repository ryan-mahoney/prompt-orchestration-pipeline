// ── src/providers/openai.ts ──
// OpenAI adapter with Responses API / Chat Completions API routing and fallback.

import OpenAI from "openai";
import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  extractMessages,
  isRetryableError,
  sleep,
  stripMarkdownFences,
  tryParseJSON,
  ensureJsonResponseFormat,
} from "./base.ts";
import { IdleTimeoutController } from "./stream-accumulator.ts";
import { ProviderJsonParseError } from "./types.ts";
import type { AdapterUsage, OpenAIOptions, AdapterResponse } from "./types.ts";
import type { Response as OAIResponse } from "openai/resources/responses/responses.mjs";
import type { ChatCompletion } from "openai/resources/chat/completions/completions.mjs";

const DEFAULT_MODEL = "gpt-5-chat-latest";
const DEFAULT_RESPONSE_FORMAT = "json_object";
const DEFAULT_MAX_RETRIES = 3;
const GPT5_PATTERN = /^gpt-5/i;

interface ClientConfig {
  apiKey: string | undefined;
  organization: string | undefined;
  baseURL: string | undefined;
}

let defaultClient: OpenAI | null = null;
let defaultClientConfig: ClientConfig | null = null;

function createClient(timeoutMs: number, config: ClientConfig): OpenAI {
  return new OpenAI({
    apiKey: config.apiKey,
    organization: config.organization,
    baseURL: config.baseURL,
    maxRetries: 0,
    timeout: timeoutMs,
  });
}

function getClient(timeoutMs: number): OpenAI {
  const config: ClientConfig = {
    apiKey: process.env["OPENAI_API_KEY"],
    organization: process.env["OPENAI_ORGANIZATION"],
    baseURL: process.env["OPENAI_BASE_URL"],
  };

  // Avoid an unbounded cache: only the default timeout is cached.
  if (timeoutMs !== DEFAULT_REQUEST_TIMEOUT_MS) {
    return createClient(timeoutMs, config);
  }

  const configChanged =
    !defaultClientConfig ||
    defaultClientConfig.apiKey !== config.apiKey ||
    defaultClientConfig.organization !== config.organization ||
    defaultClientConfig.baseURL !== config.baseURL;

  if (!defaultClient || configChanged) {
    defaultClient = createClient(timeoutMs, config);
    defaultClientConfig = config;
  }

  return defaultClient;
}

/** Visible for testing — resets the client cache so tests get a fresh client. */
export function _resetClient(): void {
  defaultClient = null;
  defaultClientConfig = null;
}

async function callResponsesAPI(
  openai: OpenAI,
  model: string,
  systemMsg: string,
  userMsg: string,
  temperature: number,
  maxTokens: number,
  responseFormat: string,
  responseSchema: unknown | undefined,
): Promise<AdapterResponse> {
  const params: Record<string, unknown> = {
    model,
    input: userMsg,
    temperature,
    max_output_tokens: maxTokens,
  };

  if (systemMsg) {
    params["instructions"] = systemMsg;
  }

  if (responseSchema != null) {
    params["text"] = {
      format: {
        type: "json_schema",
        name: "Response",
        schema: responseSchema,
      },
    };
  } else if (responseFormat === "json_object" || responseFormat === "json") {
    params["text"] = { format: { type: "json_object" } };
  }

  const response = (await openai.responses.create(
    params as Parameters<typeof openai.responses.create>[0],
  )) as unknown as OAIResponse;

  const rawText = response.output_text ?? "";
  const stripped = stripMarkdownFences(rawText);
  const parsed = tryParseJSON(stripped);

  // Estimate usage at ~4 chars/token since Responses API may not return usage
  const inputTokens = response.usage?.input_tokens ?? Math.ceil(userMsg.length / 4);
  const outputTokens = response.usage?.output_tokens ?? Math.ceil(rawText.length / 4);

  const usage = {
    prompt_tokens: inputTokens,
    completion_tokens: outputTokens,
    total_tokens: inputTokens + outputTokens,
  };

  return {
    content: typeof parsed === "string" ? parsed : (parsed as Record<string, unknown>),
    text: rawText,
    usage,
    raw: response,
  };
}

async function callChatCompletionsAPI(
  openai: OpenAI,
  model: string,
  systemMsg: string,
  userMsg: string,
  temperature: number,
  maxTokens: number,
  responseFormat: string,
  responseSchema: unknown | undefined,
  seed: number | undefined,
  frequencyPenalty: number | undefined,
  presencePenalty: number | undefined,
  topP: number | undefined,
  stop: string | string[] | undefined,
): Promise<AdapterResponse> {
  const messages: Array<{ role: "system" | "user"; content: string }> = [];

  if (systemMsg) {
    messages.push({ role: "system", content: systemMsg });
  }
  messages.push({ role: "user", content: userMsg });

  const params: Record<string, unknown> = {
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
  };

  if (responseSchema != null || responseFormat === "json_object" || responseFormat === "json") {
    params["response_format"] = { type: "json_object" };
  }

  if (seed !== undefined) params["seed"] = seed;
  if (frequencyPenalty !== undefined) params["frequency_penalty"] = frequencyPenalty;
  if (presencePenalty !== undefined) params["presence_penalty"] = presencePenalty;
  if (topP !== undefined) params["top_p"] = topP;
  if (stop !== undefined) params["stop"] = stop;

  const completion = (await openai.chat.completions.create(
    params as unknown as Parameters<typeof openai.chat.completions.create>[0],
  )) as unknown as ChatCompletion;

  const choice = completion.choices[0];
  const rawText = choice?.message?.content ?? "";
  const stripped = stripMarkdownFences(rawText);
  const parsed = tryParseJSON(stripped);

  const usage = {
    prompt_tokens: completion.usage?.prompt_tokens ?? 0,
    completion_tokens: completion.usage?.completion_tokens ?? 0,
    total_tokens: completion.usage?.total_tokens ?? 0,
  };

  return {
    content: typeof parsed === "string" ? parsed : (parsed as Record<string, unknown>),
    text: rawText,
    usage,
    raw: completion,
  };
}

async function callStreamingResponsesAPI(
  openai: OpenAI,
  model: string,
  systemMsg: string,
  userMsg: string,
  temperature: number,
  maxTokens: number,
  responseFormat: string,
  responseSchema: unknown | undefined,
): Promise<AdapterResponse> {
  const params: Record<string, unknown> = {
    model,
    input: userMsg,
    temperature,
    max_output_tokens: maxTokens,
    stream: true,
  };

  if (systemMsg) {
    params["instructions"] = systemMsg;
  }

  if (responseSchema != null) {
    params["text"] = {
      format: {
        type: "json_schema",
        name: "Response",
        schema: responseSchema,
      },
    };
  } else if (responseFormat === "json_object" || responseFormat === "json") {
    params["text"] = { format: { type: "json_object" } };
  }

  const idle = new IdleTimeoutController(DEFAULT_REQUEST_TIMEOUT_MS);

  const stream = await openai.responses.create({
    ...(params as Parameters<typeof openai.responses.create>[0]),
    signal: idle.signal,
  } as Parameters<typeof openai.responses.create>[0]);

  let text = "";
  let usage: AdapterUsage | undefined;

  try {
    for await (const event of stream as AsyncIterable<Record<string, unknown>>) {
      idle.reset();
      const type = event.type as string | undefined;

      if (type === "response.output_text.delta") {
        text += (event as { delta?: string }).delta ?? "";
      } else if (type === "response.completed") {
        const resp = event.response as Record<string, unknown> | undefined;
        const u = resp?.usage as Record<string, number> | undefined;
        if (u) {
          usage = {
            prompt_tokens: u.input_tokens ?? 0,
            completion_tokens: u.output_tokens ?? 0,
            total_tokens: (u.input_tokens ?? 0) + (u.output_tokens ?? 0),
          };
        }
      }
    }
  } finally {
    idle.cleanup();
  }

  if (!usage) {
    const inputTokens = Math.ceil(userMsg.length / 4);
    const outputTokens = Math.ceil(text.length / 4);
    usage = {
      prompt_tokens: inputTokens,
      completion_tokens: outputTokens,
      total_tokens: inputTokens + outputTokens,
    };
  }

  const stripped = stripMarkdownFences(text);
  const parsed = tryParseJSON(stripped);

  return {
    content: typeof parsed === "string" ? parsed : (parsed as Record<string, unknown>),
    text,
    usage,
  };
}

async function callStreamingChatCompletionsAPI(
  openai: OpenAI,
  model: string,
  systemMsg: string,
  userMsg: string,
  temperature: number,
  maxTokens: number,
  responseFormat: string,
  responseSchema: unknown | undefined,
  seed: number | undefined,
  frequencyPenalty: number | undefined,
  presencePenalty: number | undefined,
  topP: number | undefined,
  stop: string | string[] | undefined,
): Promise<AdapterResponse> {
  const messages: Array<{ role: "system" | "user"; content: string }> = [];

  if (systemMsg) {
    messages.push({ role: "system", content: systemMsg });
  }
  messages.push({ role: "user", content: userMsg });

  const params: Record<string, unknown> = {
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
    stream: true,
    stream_options: { include_usage: true },
  };

  if (responseSchema != null || responseFormat === "json_object" || responseFormat === "json") {
    params["response_format"] = { type: "json_object" };
  }

  if (seed !== undefined) params["seed"] = seed;
  if (frequencyPenalty !== undefined) params["frequency_penalty"] = frequencyPenalty;
  if (presencePenalty !== undefined) params["presence_penalty"] = presencePenalty;
  if (topP !== undefined) params["top_p"] = topP;
  if (stop !== undefined) params["stop"] = stop;

  const idle = new IdleTimeoutController(DEFAULT_REQUEST_TIMEOUT_MS);

  const stream = await openai.chat.completions.create({
    ...(params as unknown as Parameters<typeof openai.chat.completions.create>[0]),
    signal: idle.signal,
  } as unknown as Parameters<typeof openai.chat.completions.create>[0]);

  let text = "";
  let usage: AdapterUsage | undefined;

  try {
    for await (const chunk of stream as AsyncIterable<Record<string, unknown>>) {
      idle.reset();

      const choices = chunk.choices as
        | Array<{ delta?: { content?: string }; finish_reason?: string }>
        | undefined;
      text += choices?.[0]?.delta?.content ?? "";

      const u = chunk.usage as Record<string, number> | undefined;
      if (u && typeof u.prompt_tokens === "number") {
        usage = {
          prompt_tokens: u.prompt_tokens,
          completion_tokens: u.completion_tokens ?? 0,
          total_tokens: u.total_tokens ?? (u.prompt_tokens + (u.completion_tokens ?? 0)),
        };
      }
    }
  } finally {
    idle.cleanup();
  }

  if (!usage) {
    usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  }

  const stripped = stripMarkdownFences(text);
  const parsed = tryParseJSON(stripped);

  return {
    content: typeof parsed === "string" ? parsed : (parsed as Record<string, unknown>),
    text,
    usage,
  };
}

export async function openaiChat(
  options: OpenAIOptions,
): Promise<AdapterResponse> {
  const {
    messages,
    model = DEFAULT_MODEL,
    temperature = 0.7,
    maxTokens = 4096,
    responseFormat = DEFAULT_RESPONSE_FORMAT,
    maxRetries = DEFAULT_MAX_RETRIES,
    seed,
    frequencyPenalty,
    presencePenalty,
    topP,
    stop,
    requestTimeoutMs,
    // Destructure and discard max_tokens to prevent ...rest leakage
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    max_tokens: _discardedMaxTokens,
    ...rest
  } = options;

  ensureJsonResponseFormat(responseFormat, "openai");

  const formatStr =
    typeof responseFormat === "string"
      ? responseFormat
      : (responseFormat as { type?: string }).type ?? "json_object";
  const responseSchema =
    typeof responseFormat === "object" &&
    responseFormat !== null &&
    "json_schema" in responseFormat
      ? (responseFormat as { json_schema?: unknown }).json_schema
      : undefined;

  const { systemMsg, userMsg } = extractMessages(messages);
  const timeoutMs = requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const openai = getClient(timeoutMs);
  const useResponsesAPI = GPT5_PATTERN.test(model);

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (useResponsesAPI) {
        try {
          const result = await callStreamingResponsesAPI(
            openai, model, systemMsg, userMsg, temperature, maxTokens, formatStr, responseSchema,
          );
          checkJsonParse(result, model, formatStr);
          return result;
        } catch (responsesErr) {
          // On "unsupported" error, fall back to streaming Chat Completions within same attempt
          if (isUnsupportedError(responsesErr)) {
            const result = await callStreamingChatCompletionsAPI(
              openai, model, systemMsg, userMsg, temperature, maxTokens, formatStr, responseSchema,
              seed, frequencyPenalty, presencePenalty, topP, stop,
            );
            checkJsonParse(result, model, formatStr);
            return result;
          }
          throw responsesErr;
        }
      }

      const result = await callStreamingChatCompletionsAPI(
        openai, model, systemMsg, userMsg, temperature, maxTokens, formatStr, responseSchema,
        seed, frequencyPenalty, presencePenalty, topP, stop,
      );
      checkJsonParse(result, model, formatStr);
      return result;
    } catch (err) {
      lastError = err;

      // 401 / auth errors are never retried
      if (isAuthError(err)) throw err;

      if (!isRetryableError(err) || attempt >= maxRetries) throw err;

      await sleep(Math.pow(2, attempt) * 1000);
    }
  }

  throw lastError;
}

function checkJsonParse(
  result: AdapterResponse,
  model: string,
  formatStr: string,
): void {
  const isJsonMode = formatStr === "json" || formatStr === "json_object";
  if (isJsonMode && typeof result.content === "string") {
    throw new ProviderJsonParseError(
      "openai",
      model,
      (result.content as string).slice(0, 200),
    );
  }
}

function isUnsupportedError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const message = err.message.toLowerCase();
  return message.includes("unsupported");
}

function isAuthError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const status = (err as { status?: number }).status;
  return status === 401;
}
