import {
  extractMessages,
  isRetryableError,
  sleep,
  tryParseJSON,
  ensureJsonResponseFormat,
  ProviderJsonParseError,
} from "./base.js";

export async function zhipuChat({
  messages,
  model = "glm-4-plus",
  temperature = 0.7,
  maxTokens,
  responseFormat,
  topP,
  frequencyPenalty,
  presencePenalty,
  stop,
  maxRetries = 3,
  ...rest
}) {
  // Enforce JSON mode - reject calls without proper JSON responseFormat
  ensureJsonResponseFormat(responseFormat, "Zhipu");

  if (!process.env.ZHIPU_API_KEY) {
    throw new Error("Zhipu API key not configured");
  }

  const { systemMsg, userMsg } = extractMessages(messages);

  // Build system guard for JSON enforcement
  let system = systemMsg;

  if (responseFormat === "json" || responseFormat?.type === "json_object") {
    system = `${systemMsg}\n\nYou must output strict JSON only with no extra text.`;
  }

  if (responseFormat?.json_schema) {
    system = `${systemMsg}\n\nYou must output strict JSON only matching this schema (no extra text):\n${JSON.stringify(responseFormat.json_schema)}`;
  }

  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      await sleep(Math.pow(2, attempt) * 1000);
    }

    try {
      const requestBody = {
        model,
        messages: [
          ...(system ? [{ role: "system", content: system }] : []),
          { role: "user", content: userMsg },
        ],
        temperature,
        max_tokens: maxTokens,
        ...(topP !== undefined ? { top_p: topP } : {}),
        ...(stop !== undefined ? { stop: stop } : {}),
      };

      const response = await fetch(
        process.env.ZHIPU_BASE_URL ||
          "https://open.bigmodel.cn/api/paas/v4/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.ZHIPU_API_KEY}`,
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

      // Extract text from response
      const text = data?.choices?.[0]?.message?.content || "";

      // Parse JSON - this is required for all calls
      const parsed = tryParseJSON(text);
      if (!parsed) {
        throw new ProviderJsonParseError(
          "Zhipu",
          model,
          text.substring(0, 200),
          "Failed to parse JSON response from Zhipu API"
        );
      }

      // Normalize usage (if provided)
      const prompt_tokens = data?.usage?.prompt_tokens;
      const completion_tokens = data?.usage?.completion_tokens;
      const total_tokens = (prompt_tokens ?? 0) + (completion_tokens ?? 0);
      const usage =
        prompt_tokens != null && completion_tokens != null
          ? { prompt_tokens, completion_tokens, total_tokens }
          : undefined;

      return {
        content: parsed,
        text,
        ...(usage ? { usage } : {}),
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
export async function queryZhipu(system, prompt, model = "glm-4-plus") {
  const response = await zhipuChat({
    messages: [
      { role: "system", content: system },
      { role: "user", content: prompt },
    ],
    model,
    responseFormat: "json",
  });

  return response.content;
}
