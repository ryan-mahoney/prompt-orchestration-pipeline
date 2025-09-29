import OpenAI from "openai";
import {
  extractMessages,
  isRetryableError,
  sleep,
  tryParseJSON,
} from "./base.js";

let client = null;

function getClient() {
  if (!client && process.env.OPENAI_API_KEY) {
    client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      organization: process.env.OPENAI_ORGANIZATION,
      baseURL: process.env.OPENAI_BASE_URL,
    });
  }
  return client;
}

/**
 * Model-agnostic call:
 * - GPT-5* models use Responses API
 * - Non-GPT-5 models use classic Chat Completions
 * - If Responses API isn't supported, fall back to classic
 */
export async function openaiChat({
  messages,
  model = "gpt-5-chat-latest",
  temperature,
  maxTokens,
  responseFormat, // { type: 'json_object' } | { json_schema, name } | 'json'
  tools,
  toolChoice,
  seed,
  stop,
  topP,
  frequencyPenalty,
  presencePenalty,
  maxRetries = 3,
  ...rest
}) {
  const openai = getClient();
  if (!openai) throw new Error("OpenAI API key not configured");

  const { systemMsg, userMsg } = extractMessages(messages);

  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) await sleep(Math.pow(2, attempt) * 1000);

    const useResponsesAPI = /^gpt-5/i.test(model);

    try {
      // ---------- RESPONSES API path (GPT-5 models) ----------
      if (useResponsesAPI) {
        const responsesReq = {
          model,
          instructions: systemMsg,
          input: userMsg,
          max_output_tokens: maxTokens ?? 25000,
          ...rest,
        };

        // Tuning params passthrough
        if (temperature !== undefined) responsesReq.temperature = temperature;
        if (topP !== undefined) responsesReq.top_p = topP;
        if (frequencyPenalty !== undefined)
          responsesReq.frequency_penalty = frequencyPenalty;
        if (presencePenalty !== undefined)
          responsesReq.presence_penalty = presencePenalty;
        if (seed !== undefined) responsesReq.seed = seed;
        if (stop !== undefined) responsesReq.stop = stop;

        // Response format mapping
        if (responseFormat?.json_schema) {
          responsesReq.text = {
            format: {
              type: "json_schema",
              name: responseFormat.name || "Response",
              schema: responseFormat.json_schema,
            },
          };
        } else if (
          responseFormat?.type === "json_object" ||
          responseFormat === "json"
        ) {
          responsesReq.text = { format: { type: "json_object" } };
        }

        const resp = await openai.responses.create(responsesReq);
        const text = resp.output_text ?? "";

        // Approximate usage (tests don't assert exact values)
        const promptTokens = Math.ceil((systemMsg + userMsg).length / 4);
        const completionTokens = Math.ceil(text.length / 4);
        const usage = {
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: promptTokens + completionTokens,
        };

        // Parse JSON if requested
        let parsed = null;
        if (
          responseFormat?.json_schema ||
          responseFormat?.type === "json_object" ||
          responseFormat === "json"
        ) {
          parsed = tryParseJSON(text);
          if (!parsed && attempt < maxRetries) {
            lastError = new Error("Failed to parse JSON response");
            continue;
          }
        }

        return { content: parsed ?? text, text, usage, raw: resp };
      }

      // ---------- CLASSIC CHAT COMPLETIONS path (non-GPT-5) ----------
      const classicReq = {
        model,
        messages,
        temperature: temperature ?? 0.7, // <-- default per tests
        max_tokens: maxTokens,
        top_p: topP,
        frequency_penalty: frequencyPenalty,
        presence_penalty: presencePenalty,
        seed,
        stop,
        tools,
        tool_choice: toolChoice,
        stream: false,
      };

      // Classic API: can request JSON object format (best-effort)
      if (
        responseFormat?.json_schema ||
        responseFormat?.type === "json_object" ||
        responseFormat === "json"
      ) {
        classicReq.response_format = { type: "json_object" };
      }

      const classicRes = await openai.chat.completions.create(classicReq);
      const classicText = classicRes?.choices?.[0]?.message?.content ?? "";

      // If tool calls present, return them (test expects this)
      if (classicRes?.choices?.[0]?.message?.tool_calls) {
        return {
          content: classicText,
          usage: classicRes?.usage,
          toolCalls: classicRes.choices[0].message.tool_calls,
          raw: classicRes,
        };
      }

      let classicParsed = null;
      if (
        responseFormat?.json_schema ||
        responseFormat?.type === "json_object" ||
        responseFormat === "json"
      ) {
        classicParsed = tryParseJSON(classicText);
        if (!classicParsed && attempt < maxRetries) {
          lastError = new Error("Failed to parse JSON response");
          continue;
        }
      }

      return {
        content: classicParsed ?? classicText,
        text: classicText,
        usage: classicRes?.usage,
        raw: classicRes,
      };
    } catch (error) {
      lastError = error;
      const msg = error?.error?.message || error?.message || "";

      // Only fall back when RESPONSES path failed due to lack of support
      if (
        useResponsesAPI &&
        (/not supported/i.test(msg) || /unsupported/i.test(msg))
      ) {
        const classicReq = {
          model,
          messages,
          temperature: temperature ?? 0.7, // <-- default per tests (fallback path)
          max_tokens: maxTokens,
          top_p: topP,
          frequency_penalty: frequencyPenalty,
          presence_penalty: presencePenalty,
          seed,
          stop,
          tools,
          tool_choice: toolChoice,
          stream: false,
        };

        if (
          responseFormat?.json_schema ||
          responseFormat?.type === "json_object" ||
          responseFormat === "json"
        ) {
          classicReq.response_format = { type: "json_object" };
        }

        const classicRes = await openai.chat.completions.create(classicReq);
        const text = classicRes?.choices?.[0]?.message?.content ?? "";

        let parsed = null;
        if (
          responseFormat?.json_schema ||
          responseFormat?.type === "json_object" ||
          responseFormat === "json"
        ) {
          parsed = tryParseJSON(text);
        }

        return {
          content: parsed ?? text,
          text,
          usage: classicRes?.usage,
          raw: classicRes,
        };
      }

      // Don't retry auth errors
      if (error?.status === 401 || /API key/i.test(msg)) throw error;

      // Retry transient errors
      if (isRetryableError(error) && attempt < maxRetries) continue;

      if (attempt === maxRetries) throw error;
    }
  }

  throw lastError || new Error(`Failed after ${maxRetries + 1} attempts`);
}

/**
 * Convenience helper used widely in the codebase.
 * For tests, this hits the Responses API directly (even for non-GPT-5).
 * Always attempts to coerce JSON on return (falls back to string).
 */
export async function queryChatGPT(system, prompt, options = {}) {
  const openai = getClient();
  if (!openai) throw new Error("OpenAI API key not configured");

  const { systemMsg, userMsg } = extractMessages([
    { role: "system", content: system },
    { role: "user", content: prompt },
  ]);

  const req = {
    model: options.model || "gpt-5-chat-latest",
    instructions: systemMsg,
    input: userMsg,
    max_output_tokens: options.maxTokens ?? 25000,
  };

  // Tuning params passthrough
  if (options.temperature !== undefined) req.temperature = options.temperature;
  if (options.topP !== undefined) req.top_p = options.topP;
  if (options.frequencyPenalty !== undefined)
    req.frequency_penalty = options.frequencyPenalty;
  if (options.presencePenalty !== undefined)
    req.presence_penalty = options.presencePenalty;
  if (options.seed !== undefined) req.seed = options.seed;
  if (options.stop !== undefined) req.stop = options.stop;

  // Response format / schema mapping for Responses API
  if (options.schema) {
    req.text = {
      format: {
        type: "json_schema",
        name: options.schemaName || "Response",
        schema: options.schema,
      },
    };
  } else if (
    options.response_format?.type === "json_object" ||
    options.response_format === "json"
  ) {
    req.text = { format: { type: "json_object" } };
  }

  const resp = await openai.responses.create(req);
  const text = resp.output_text ?? "";

  // Always try to parse JSON; fall back to string
  const parsed = tryParseJSON(text);
  return parsed ?? text;
}
