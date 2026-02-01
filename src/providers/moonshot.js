import {
  extractMessages,
  isRetryableError,
  sleep,
  stripMarkdownFences,
  tryParseJSON,
  ProviderJsonParseError,
  createProviderError,
} from "./base.js";
import { createLogger } from "../core/logger.js";

const logger = createLogger("Moonshot");

export async function moonshotChat({
  messages,
  model = "moonshot-v1-128k",
  temperature = 0.7,
  maxTokens,
  responseFormat = "json_object",
  topP,
  frequencyPenalty,
  presencePenalty,
  stop,
  stream = false,
  maxRetries = 3,
}) {
  const isJsonMode =
    responseFormat?.type === "json_object" ||
    responseFormat?.type === "json_schema" ||
    responseFormat === "json" ||
    responseFormat === "json_object";

  logger.log("moonshotChat called", { model, stream, maxRetries, isJsonMode });

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
      // Thinking models only accept temperature=1
      //const isThinkingModel = model.includes("thinking");
      //const effectiveTemperature = isThinkingModel ? 1 : temperature;

      const requestBody = {
        model,
        messages: [
          { role: "system", content: systemMsg },
          { role: "user", content: userMsg },
        ],
        temperature: 1,
        max_tokens: maxTokens,
        top_p: topP,
        frequency_penalty: frequencyPenalty,
        presence_penalty: presencePenalty,
        stop,
        stream,
      };

      if (isJsonMode && !stream) {
        requestBody.response_format = { type: "json_object" };
      }

      logger.log("About to call fetch...");
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

        // Provide more helpful error message for authentication failures
        if (response.status === 401) {
          const enhancedError = createProviderError(
            response.status,
            errorBody,
            "Invalid Moonshot API key. Please verify your MOONSHOT_API_KEY environment variable is correct and has not expired. Get your API key at https://platform.moonshot.cn/",
          );
          throw enhancedError;
        }

        throw createProviderError(
          response.status,
          errorBody,
          response.statusText,
        );
      }

      // Step 6: Handle streaming response path
      if (stream) {
        logger.log("Handling streaming response");
        return createStreamGenerator(response.body);
      }

      // Step 7: Handle non-streaming response parsing
      logger.log("Parsing JSON response...");
      const data = await response.json();
      logger.log("JSON parsed successfully", {
        hasChoices: !!data.choices,
        choicesCount: data.choices?.length,
      });
      const rawContent = data.choices[0].message.content;

      const content = stripMarkdownFences(rawContent);

      if (isJsonMode) {
        const parsed = tryParseJSON(content);
        if (!parsed) {
          throw new ProviderJsonParseError(
            "Moonshot",
            model,
            content.substring(0, 200),
            "Failed to parse JSON response from Moonshot API",
          );
        }
        return {
          content: parsed,
          usage: data.usage,
          raw: data,
        };
      }

      return {
        content,
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

      if (error.status === 401) throw error;

      if (isRetryableError(error) && attempt < maxRetries) {
        continue;
      }

      if (attempt === maxRetries) throw error;
    }
  }

  throw lastError || new Error(`Failed after ${maxRetries + 1} attempts`);
}

/**
 * Create async generator for streaming Moonshot responses.
 * Moonshot uses Server-Sent Events format with "data:" prefix.
 */
async function* createStreamGenerator(stream) {
  const decoder = new TextDecoder();
  const reader = stream.getReader();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop(); // Keep incomplete line

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6);
          if (data === "[DONE]") continue;

          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices?.[0]?.delta?.content;
            // Skip only truly empty chunks; preserve whitespace-only content
            if (content !== undefined && content !== null && content !== "") {
              yield { content };
            }
          } catch (e) {
            // Skip malformed JSON
            logger.warn("Failed to parse stream chunk:", e);
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
