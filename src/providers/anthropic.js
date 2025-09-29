import Anthropic from "@anthropic-ai/sdk";
import {
  extractMessages,
  isRetryableError,
  sleep,
  tryParseJSON,
} from "./base.js";

let client = null;

function getClient() {
  if (!client && process.env.ANTHROPIC_API_KEY) {
    client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      baseURL: process.env.ANTHROPIC_BASE_URL,
    });
  }
  return client;
}

export async function anthropicChat({
  messages,
  model = "claude-3-opus-20240229",
  temperature = 0.7,
  maxTokens = 4096,
  responseFormat,
  topP,
  topK,
  stopSequences,
  maxRetries = 3,
}) {
  const anthropic = getClient();
  if (!anthropic) throw new Error("Anthropic API key not configured");

  const { systemMsg, userMessages, assistantMessages } =
    extractMessages(messages);

  // Convert messages to Anthropic format
  const anthropicMessages = [];
  for (const msg of messages) {
    if (msg.role === "user" || msg.role === "assistant") {
      anthropicMessages.push({
        role: msg.role,
        content: msg.content,
      });
    }
  }

  // Ensure messages alternate and start with user
  if (anthropicMessages.length === 0 || anthropicMessages[0].role !== "user") {
    anthropicMessages.unshift({ role: "user", content: "Hello" });
  }

  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      await sleep(Math.pow(2, attempt) * 1000);
    }

    try {
      const request = {
        model,
        messages: anthropicMessages,
        max_tokens: maxTokens,
        temperature,
        top_p: topP,
        top_k: topK,
        stop_sequences: stopSequences,
      };

      // Add system message if present
      if (systemMsg) {
        request.system = systemMsg;
      }

      const result = await anthropic.messages.create(request);

      // Extract text content
      const content = result.content[0].text;

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
        text: content,
        usage: {
          prompt_tokens: result.usage.input_tokens,
          completion_tokens: result.usage.output_tokens,
          total_tokens: result.usage.input_tokens + result.usage.output_tokens,
          cache_read_input_tokens: result.usage.cache_creation_input_tokens,
          cache_write_input_tokens: result.usage.cache_write_input_tokens,
        },
        raw: result,
      };
    } catch (error) {
      lastError = error;

      if (error.status === 401) throw error;

      if (isRetryableError(error) && attempt < maxRetries) {
        continue;
      }

      if (attempt === maxRetries) throw error;
    }
  }

  throw lastError || new Error(`Failed after ${maxRetries + 1} attempts`);
}
