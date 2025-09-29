import {
  extractMessages,
  isRetryableError,
  sleep,
  tryParseJSON,
} from "./base.js";

export async function deepseekChat({
  messages,
  model = "deepseek-reasoner",
  temperature = 0.7,
  maxTokens,
  responseFormat,
  topP,
  frequencyPenalty,
  presencePenalty,
  stop,
  maxRetries = 3,
}) {
  if (!process.env.DEEPSEEK_API_KEY) {
    throw new Error("DeepSeek API key not configured");
  }

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
      };

      // Add response format if needed
      if (responseFormat?.type === "json_object" || responseFormat === "json") {
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

      const data = await response.json();
      const content = data.choices[0].message.content;

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

// Keep backward compatibility
export async function queryDeepSeek(
  system,
  prompt,
  model = "deepseek-reasoner"
) {
  const response = await deepseekChat({
    messages: [
      { role: "system", content: system },
      { role: "user", content: prompt },
    ],
    model,
    responseFormat: "json",
  });

  return response.content;
}
