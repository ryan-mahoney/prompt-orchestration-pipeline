import {
  extractMessages,
  isRetryableError,
  sleep,
  tryParseJSON,
  ensureJsonResponseFormat,
  ProviderJsonParseError,
} from "./base.js";

export async function deepseekChat({
  messages,
  model = "deepseek-chat",
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
  if (!process.env.DEEPSEEK_API_KEY) {
    throw new Error("DeepSeek API key not configured");
  }

  // Determine if JSON mode is requested
  const isJsonMode =
    responseFormat?.type === "json_object" ||
    responseFormat?.type === "json_schema" ||
    responseFormat === "json";

  const { systemMsg, userMsg } = extractMessages(messages);

  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      await sleep(Math.pow(2, attempt) * 1000);
    }

    try {
      const requestBody = {
        model,
        messages: [
          { role: "system", content: systemMsg },
          { role: "user", content: userMsg },
        ],
        temperature,
        max_tokens: maxTokens,
        top_p: topP,
        frequency_penalty: frequencyPenalty,
        presence_penalty: presencePenalty,
        stop,
        stream,
      };

      // Add response format only for JSON mode (streaming uses text mode)
      if (isJsonMode && !stream) {
        requestBody.response_format = { type: "json_object" };
      }

      const response = await fetch(
        "https://api.deepseek.com/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
          },
          body: JSON.stringify(requestBody),
        }
      );

      if (!response.ok) {
        const error = await response
          .json()
          .catch(() => ({ error: response.statusText }));
        throw { status: response.status, ...error };
      }

      // Streaming mode - return async generator for real-time chunks
      if (stream) {
        return createStreamGenerator(response.body);
      }

      const data = await response.json();
      const content = data.choices[0].message.content;

      // Parse JSON only in JSON mode; return raw string for text mode
      if (isJsonMode) {
        const parsed = tryParseJSON(content);
        if (!parsed) {
          throw new ProviderJsonParseError(
            "DeepSeek",
            model,
            content.substring(0, 200),
            "Failed to parse JSON response from DeepSeek API"
          );
        }
        return {
          content: parsed,
          usage: data.usage,
          raw: data,
        };
      }

      // Text mode - return raw string
      return {
        content,
        usage: data.usage,
        raw: data,
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

/**
 * Create async generator for streaming DeepSeek responses.
 * DeepSeek uses Server-Sent Events format with "data:" prefix.
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
            console.warn("[deepseek] Failed to parse stream chunk:", e);
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
