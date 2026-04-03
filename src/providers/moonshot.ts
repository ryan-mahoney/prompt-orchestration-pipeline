// ── src/providers/moonshot.ts ──
// Moonshot adapter with content-filter fallback to DeepSeek.

import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  extractMessages,
  ensureMessagesPresent,
  isRetryableError,
  sleep,
  stripMarkdownFences,
  tryParseJSON,
  createProviderError,
} from "./base.ts";
import { ProviderJsonParseError } from "./types.ts";
import type { MoonshotOptions, AdapterResponse } from "./types.ts";
import { deepseekChat } from "./deepseek.ts";
import {
  IdleTimeoutController,
  frameSse,
  parseOpenAiSse,
  accumulateStream,
} from "./stream-accumulator.ts";

const MOONSHOT_API_URL = "https://api.moonshot.ai/v1/chat/completions";
const DEFAULT_MODEL = "kimi-k2.5";
const DEFAULT_MAX_TOKENS = 32768;
const DEFAULT_THINKING: "enabled" | "disabled" = "enabled";
const DEFAULT_MAX_RETRIES = 3;

/** Returns true when error body text indicates a content-filter rejection. */
function isContentFilterError(errorBody: unknown): boolean {
  const text =
    typeof errorBody === "string"
      ? errorBody
      : JSON.stringify(errorBody ?? "");
  const lower = text.toLowerCase();
  return lower.includes("high risk") || lower.includes("rejected");
}

export async function moonshotChat(
  options: MoonshotOptions,
): Promise<AdapterResponse> {
  const {
    messages,
    model = DEFAULT_MODEL,
    maxTokens = DEFAULT_MAX_TOKENS,
    thinking = DEFAULT_THINKING,
    maxRetries = DEFAULT_MAX_RETRIES,
    responseFormat,
    requestTimeoutMs,
  } = options;

  ensureMessagesPresent(messages, "moonshot");

  const { systemMsg, userMessages, assistantMessages } =
    extractMessages(messages);

  // Build conversation-ordered messages array
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

  const apiKey = process.env["MOONSHOT_API_KEY"];

  const body: Record<string, unknown> = {
    model,
    messages: apiMessages,
    max_tokens: maxTokens,
    thinking: { type: thinking },
    stream: true,
  };

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const idle = new IdleTimeoutController(
        requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
      );
      const response = await fetch(MOONSHOT_API_URL, {
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

        // Content-filter fallback: HTTP 400 with "high risk" or "rejected"
        if (response.status === 400 && isContentFilterError(errorBody)) {
          const deepseekKey = process.env["DEEPSEEK_API_KEY"];
          if (deepseekKey) {
            const deepseekModel =
              thinking === "enabled" ? "deepseek-reasoner" : "deepseek-chat";
            return deepseekChat({
              messages,
              model: deepseekModel,
              responseFormat: responseFormat ?? "json_object",
              requestTimeoutMs,
            });
          }
        }

        const err = createProviderError(
          response.status,
          errorBody,
          `Moonshot API error: ${response.status}`,
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

      // Always in JSON mode — string result means parse failure
      if (typeof parsed === "string") {
        throw new ProviderJsonParseError(
          "moonshot",
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
        content: parsed as Record<string, unknown>,
        usage,
        raw: { accumulated: rawText },
      };
    } catch (err) {
      lastError = err;

      // ProviderJsonParseError is never retried for Moonshot
      if (err instanceof ProviderJsonParseError) {
        throw err;
      }

      if (!isRetryableError(err) || attempt >= maxRetries) {
        throw err;
      }

      // Exponential backoff: 2^attempt * 1000ms
      await sleep(Math.pow(2, attempt) * 1000);
    }
  }

  throw lastError;
}
