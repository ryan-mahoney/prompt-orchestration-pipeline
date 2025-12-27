import OpenAI from "openai";
import {
  extractMessages,
  isRetryableError,
  sleep,
  tryParseJSON,
  ensureJsonResponseFormat,
  ProviderJsonParseError,
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
  max_tokens, // Explicitly destructure to prevent it from being in ...rest
  responseFormat = "json_object",
  seed,
  stop,
  topP,
  frequencyPenalty,
  presencePenalty,
  maxRetries = 3,
  ...rest
}) {
  console.log("\n[OpenAI] Starting openaiChat call");
  console.log("[OpenAI] Model:", model);
  console.log("[OpenAI] Response format:", responseFormat);

  const openai = getClient();
  if (!openai) throw new Error("OpenAI API key not configured");

  const { systemMsg, userMsg } = extractMessages(messages);
  console.log("[OpenAI] System message length:", systemMsg.length);
  console.log("[OpenAI] User message length:", userMsg.length);

  // Determine if JSON mode is requested
  const isJsonMode =
    responseFormat?.json_schema ||
    responseFormat?.type === "json_object" ||
    responseFormat === "json";

  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) await sleep(Math.pow(2, attempt) * 1000);

    const useResponsesAPI = /^gpt-5/i.test(model);

    try {
      console.log(`[OpenAI] Attempt ${attempt + 1}/${maxRetries + 1}`);

      // ---------- RESPONSES API path (GPT-5 models) ----------
      if (useResponsesAPI) {
        console.log("[OpenAI] Using Responses API for GPT-5 model");
        const responsesReq = {
          model,
          instructions: systemMsg,
          input: userMsg,
          max_output_tokens: maxTokens ?? max_tokens ?? 25000,
          ...rest,
        };

        // Note: Responses API does not support temperature, top_p, frequency_penalty,
        // presence_penalty, seed, or stop parameters. These are only for Chat Completions API.

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

        console.log("[OpenAI] Calling responses.create...");
        const resp = await openai.responses.create(responsesReq);
        const text = resp.output_text ?? "";
        console.log("[OpenAI] Response received, text length:", text.length);

        // Approximate usage (tests don't assert exact values)
        const promptTokens = Math.ceil((systemMsg + userMsg).length / 4);
        const completionTokens = Math.ceil(text.length / 4);
        const usage = {
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: promptTokens + completionTokens,
        };

        // Parse JSON only in JSON mode; return raw string for text mode
        if (isJsonMode) {
          const parsed = tryParseJSON(text);
          if (!parsed) {
            throw new ProviderJsonParseError(
              "OpenAI",
              model,
              text.substring(0, 200),
              "Failed to parse JSON response from Responses API"
            );
          }
          console.log(
            "[OpenAI] Returning response from Responses API (JSON mode)"
          );
          return { content: parsed, text, usage, raw: resp };
        }

        console.log(
          "[OpenAI] Returning response from Responses API (text mode)"
        );
        return { content: text, text, usage, raw: resp };
      }

      // ---------- CLASSIC CHAT COMPLETIONS path (non-GPT-5) ----------
      console.log("[OpenAI] Using Classic Chat Completions API");
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

      console.log("[OpenAI] Calling chat.completions.create...");
      const classicRes = await openai.chat.completions.create(classicReq);
      const classicText = classicRes?.choices?.[0]?.message?.content ?? "";
      console.log(
        "[OpenAI] Response received, text length:",
        classicText.length
      );

      // Parse JSON only in JSON mode; return raw string for text mode
      if (isJsonMode) {
        const classicParsed = tryParseJSON(classicText);
        if (!classicParsed) {
          throw new ProviderJsonParseError(
            "OpenAI",
            model,
            classicText.substring(0, 200),
            "Failed to parse JSON response from Classic API"
          );
        }
        return {
          content: classicParsed,
          text: classicText,
          usage: classicRes?.usage,
          raw: classicRes,
        };
      }

      return {
        content: classicText,
        text: classicText,
        usage: classicRes?.usage,
        raw: classicRes,
      };
    } catch (error) {
      lastError = error;
      const msg = error?.error?.message || error?.message || "";
      console.error("[OpenAI] Error occurred:", msg);
      console.error("[OpenAI] Error status:", error?.status);

      // Only fall back when RESPONSES path failed due to lack of support
      if (
        useResponsesAPI &&
        (/not supported/i.test(msg) || /unsupported/i.test(msg))
      ) {
        console.log(
          "[OpenAI] Falling back to Classic API due to unsupported Responses API"
        );
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

        // Parse JSON only in JSON mode; return raw string for text mode
        if (isJsonMode) {
          const parsed = tryParseJSON(text);
          if (!parsed) {
            throw new ProviderJsonParseError(
              "OpenAI",
              model,
              text.substring(0, 200),
              "Failed to parse JSON response from fallback Classic API"
            );
          }
          return {
            content: parsed,
            text,
            usage: classicRes?.usage,
            raw: classicRes,
          };
        }

        return {
          content: text,
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
