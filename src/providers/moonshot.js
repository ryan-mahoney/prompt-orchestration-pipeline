import {
  extractMessages,
  isRetryableError,
  sleep,
  stripMarkdownFences,
  tryParseJSON,
  ProviderJsonParseError,
  createProviderError,
} from "./base.js";
import { deepseekChat } from "./deepseek.js";
import { createLogger } from "../core/logger.js";

const logger = createLogger("Moonshot");

function isContentFilterError(error) {
  return error.status === 400 && /high risk|rejected/i.test(error.message);
}

async function fallbackToDeepSeek({
  messages,
  maxTokens,
  stop,
  thinking,
}) {
  const fallbackModel =
    thinking === "enabled" ? "deepseek-reasoner" : "deepseek-chat";
  logger.warn("Moonshot content filter triggered, falling back to DeepSeek", {
    fallbackModel,
    thinking,
  });
  return deepseekChat({
    messages,
    model: fallbackModel,
    maxTokens,
    responseFormat: "json_object",
    stop,
    stream: false,
  });
}

/**
 * Moonshot chat completion for kimi-k2.5 model with JSON mode.
 * 
 * Note: kimi-k2.5 does not allow modifying temperature, top_p, 
 * presence_penalty, frequency_penalty, or n parameters.
 * 
 * @param {Object} options
 * @param {Array} options.messages - Chat messages
 * @param {string} options.model - Model ID (default: kimi-k2.5)
 * @param {number} options.maxTokens - Max tokens to generate
 * @param {string|Array} options.stop - Stop sequences
 * @param {string} options.thinking - "enabled" or "disabled"
 * @param {number} options.maxRetries - Number of retries on failure
 */
export async function moonshotChat({
  messages,
  model = "kimi-k2.5",
  maxTokens = 10000,
  stop,
  thinking = "enabled",
  maxRetries = 3,
}) {
  logger.log("moonshotChat called", { model, thinking, maxRetries });

  if (!process.env.MOONSHOT_API_KEY) {
    throw new Error("Moonshot API key not configured");
  }

  const { systemMsg, userMsg } = extractMessages(messages);

  logger.log("Messages extracted", {
    systemMsgLength: systemMsg?.length,
    userMsgLength: userMsg?.length,
  });

  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      const sleepMs = Math.pow(2, attempt) * 1000;
      logger.log("Retry attempt", { attempt, sleepMs });
      await sleep(sleepMs);
    }

    try {
      logger.log("Sending request to Moonshot API", { attempt, model });

      // Build request body for kimi-k2.5
      // Note: temperature, top_p, presence_penalty, frequency_penalty cannot be modified for kimi-k2.5
      const requestBody = {
        model,
        messages: [
          { role: "system", content: systemMsg },
          { role: "user", content: userMsg },
        ],
        max_tokens: maxTokens,
        response_format: { type: "json_object" },
        thinking: { type: thinking },
        stream: false,
      };

      // Only add stop if provided
      if (stop) {
        requestBody.stop = stop;
      }

      logger.log("Request body", { 
        model: requestBody.model,
        thinking: requestBody.thinking,
        max_tokens: requestBody.max_tokens,
      });

      const response = await fetch(
        "https://api.moonshot.ai/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.MOONSHOT_API_KEY}`,
          },
          body: JSON.stringify(requestBody),
        },
      );

      logger.log("Fetch returned", {
        status: response.status,
        ok: response.ok,
      });

      if (!response.ok) {
        const errorBody = await response
          .json()
          .catch(() => ({ error: response.statusText }));

        if (response.status === 401) {
          const enhancedError = createProviderError(
            response.status,
            errorBody,
            "Invalid Moonshot API key. Please verify your MOONSHOT_API_KEY environment variable is correct and has not expired. Get your API key at https://platform.moonshot.ai/",
          );
          throw enhancedError;
        }

        throw createProviderError(
          response.status,
          errorBody,
          response.statusText,
        );
      }

      // Parse response
      const data = await response.json();
      logger.log("Response parsed", {
        hasChoices: !!data.choices,
        choicesCount: data.choices?.length,
      });

      const rawContent = data.choices[0].message.content;
      const content = stripMarkdownFences(rawContent);

      // Always parse as JSON (we always use json_object response format)
      const parsed = tryParseJSON(content);
      if (!parsed) {
        logger.warn("JSON parse failed", { 
          rawContentPreview: rawContent?.substring(0, 500),
          strippedContentPreview: content?.substring(0, 500),
        });
        throw new ProviderJsonParseError(
          "Moonshot",
          model,
          content?.substring(0, 200),
          "Failed to parse JSON response from Moonshot API",
        );
      }

      return {
        content: parsed,
        usage: data.usage,
        raw: data,
      };
    } catch (error) {
      lastError = error;
      logger.warn("Attempt failed", {
        attempt,
        errorMessage: error.message || error,
        errorStatus: error.status,
      });

      // Check for content filter error and attempt DeepSeek fallback
      if (isContentFilterError(error) && process.env.DEEPSEEK_API_KEY) {
        return fallbackToDeepSeek({
          messages,
          maxTokens,
          stop,
          thinking,
        });
      }

      // Don't retry auth errors
      if (error.status === 401) throw error;

      // Don't retry JSON parse errors
      if (error instanceof ProviderJsonParseError) throw error;

      if (isRetryableError(error) && attempt < maxRetries) {
        continue;
      }

      if (attempt === maxRetries) throw error;
    }
  }

  throw lastError || new Error(`Failed after ${maxRetries + 1} attempts`);
}