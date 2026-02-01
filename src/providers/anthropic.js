import {
  extractMessages,
  isRetryableError,
  sleep,
  stripMarkdownFences,
  tryParseJSON,
  ensureJsonResponseFormat,
  ProviderJsonParseError,
  createProviderError,
} from "./base.js";
import { createLogger } from "../core/logger.js";

const logger = createLogger("Anthropic");

export async function anthropicChat({
  messages,
  model = "claude-3-sonnet",
  temperature = 0.7,
  maxTokens = 8192,
  responseFormat = "json",
  topP,
  stop,
  maxRetries = 3,
}) {
  logger.log("\nStarting anthropicChat call");
  logger.log("Model:", model);
  logger.log("Response format:", responseFormat);

  // Enforce JSON mode - reject calls without proper JSON responseFormat
  ensureJsonResponseFormat(responseFormat, "Anthropic");

  const { systemMsg, userMsg } = extractMessages(messages);
  logger.log("System message length:", systemMsg.length);
  logger.log("User message length:", userMsg.length);

  // Build system guard for JSON enforcement
  let system = systemMsg;

  if (responseFormat === "json" || responseFormat?.type === "json_object") {
    system = `${systemMsg}\n\nYou must output strict JSON only with no extra text.`;
  }

  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      await sleep(Math.pow(2, attempt) * 1000);
    }

    try {
      logger.log(`Attempt ${attempt + 1}/${maxRetries + 1}`);

      const requestBody = {
        model,
        system,
        messages: [{ role: "user", content: userMsg }],
        temperature,
        max_tokens: maxTokens,
        ...(topP !== undefined ? { top_p: topP } : {}),
        ...(stop !== undefined ? { stop_sequences: stop } : {}),
      };

      logger.log("Calling Anthropic API...");
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": process.env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorBody = await response
          .json()
          .catch(() => ({ error: response.statusText }));
        throw createProviderError(response.status, errorBody, response.statusText);
      }

      const data = await response.json();
      logger.log("Response received from Anthropic API");

      // Extract text from response.content blocks
      const blocks = Array.isArray(data?.content) ? data.content : [];
      const rawText = blocks
        .filter((b) => b?.type === "text" && typeof b.text === "string")
        .map((b) => b.text)
        .join("");
      // Always strip markdown fences first to prevent parse failures
      const text = stripMarkdownFences(rawText);
      logger.log("Response text length:", text.length);

      // Parse JSON - this is required for all calls
      const parsed = tryParseJSON(text);
      if (!parsed) {
        throw new ProviderJsonParseError(
          "Anthropic",
          model,
          text.substring(0, 200),
          "Failed to parse JSON response from Anthropic API"
        );
      }

      // Normalize usage (if provided)
      const prompt_tokens = data?.usage?.input_tokens;
      const completion_tokens = data?.usage?.output_tokens;
      const total_tokens = (prompt_tokens ?? 0) + (completion_tokens ?? 0);
      const usage =
        prompt_tokens != null && completion_tokens != null
          ? { prompt_tokens, completion_tokens, total_tokens }
          : undefined;

      logger.log("Returning response from Anthropic API");
      return {
        content: parsed,
        text,
        ...(usage ? { usage } : {}),
        raw: data,
      };
    } catch (error) {
      lastError = error;
      const msg = error?.error?.message || error?.message || "";
      logger.error("Error occurred:", msg);
      logger.error("Error status:", error?.status);

      if (error.status === 401) throw error;

      if (isRetryableError(error) && attempt < maxRetries) {
        logger.log("Retrying due to retryable error");
        continue;
      }

      if (attempt === maxRetries) throw error;
    }
  }

  throw lastError || new Error(`Failed after ${maxRetries + 1} attempts`);
}
