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

export async function openaiChat({
  messages,
  model = "gpt-5-chat-latest",
  temperature,
  maxTokens,
  responseFormat,
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

  // Detect if we should use the new Responses API or classic Chat API
  const useResponsesAPI = model.startsWith("gpt-5");

  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      await sleep(Math.pow(2, attempt) * 1000);
    }

    try {
      let result;
      let content;
      let usage;

      if (useResponsesAPI) {
        // GPT-5 Responses API
        const request = {
          model,
          instructions: systemMsg,
          input: userMsg,
          max_output_tokens: maxTokens || 25000,
          ...rest,
        };

        // Handle response format
        if (
          responseFormat?.type === "json_object" ||
          responseFormat === "json"
        ) {
          request.text = { format: { type: "json_object" } };
        } else if (responseFormat?.json_schema) {
          request.text = {
            format: {
              type: "json_schema",
              name: responseFormat.name || "Response",
              schema: responseFormat.json_schema,
            },
          };
        }

        result = await openai.responses.create(request);
        content = result.output_text;

        // Responses API might not return usage, estimate it
        const promptTokens = Math.ceil((systemMsg + userMsg).length / 4);
        const completionTokens = Math.ceil(content.length / 4);
        usage = {
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: promptTokens + completionTokens,
        };
      } else {
        // Classic Chat Completions API (GPT-4, GPT-3.5, etc)
        const request = {
          model,
          messages,
          temperature: temperature ?? 0.7,
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

        // Handle response format for classic API
        if (
          responseFormat?.type === "json_object" ||
          responseFormat === "json"
        ) {
          request.response_format = { type: "json_object" };
        }

        result = await openai.chat.completions.create(request);
        content = result.choices[0].message.content;
        usage = result.usage;

        // Handle tool calls if present
        if (result.choices[0].message.tool_calls) {
          return {
            content,
            usage,
            toolCalls: result.choices[0].message.tool_calls,
            raw: result,
          };
        }
      }

      // Try to parse JSON if expected
      let parsed = null;
      if (responseFormat?.type === "json_object" || responseFormat === "json") {
        parsed = tryParseJSON(content);
        if (!parsed && attempt < maxRetries) {
          lastError = new Error("Failed to parse JSON response");
          continue;
        }
      }

      return {
        content: parsed || content,
        text: content, // Always include raw text
        usage,
        raw: result,
      };
    } catch (error) {
      lastError = error;

      // Don't retry auth errors
      if (error.status === 401 || error.message?.includes("API key")) {
        throw error;
      }

      // Retry on transient errors
      if (isRetryableError(error) && attempt < maxRetries) {
        continue;
      }

      // If it's a model capability error, try fallback
      const msg = error?.error?.message || error?.message || "";
      if (useResponsesAPI && /not supported/i.test(msg) && attempt === 0) {
        // Try with classic API as fallback
        model = "gpt-4-turbo-preview";
        continue;
      }

      if (attempt === maxRetries) throw error;
    }
  }

  throw lastError || new Error(`Failed after ${maxRetries + 1} attempts`);
}

// Keep backward compatibility with your existing function
export async function queryChatGPT(system, prompt, options = {}) {
  const response = await openaiChat({
    messages: [
      { role: "system", content: system },
      { role: "user", content: prompt },
    ],
    ...options,
    responseFormat: options.schema
      ? {
          type: "json_object",
          json_schema: options.schema,
          name: options.schemaName,
        }
      : options.response_format || { type: "json_object" },
  });

  return response.content;
}
