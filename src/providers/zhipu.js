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
  maxTokens = 8192,
  responseFormat = "json",
  topP,
  stop,
  maxRetries = 3,
}) {
  console.log("\n[Zhipu] Starting zhipuChat call");
  console.log("[Zhipu] Model:", model);
  console.log("[Zhipu] Response format:", responseFormat);

  // Enforce JSON mode - reject calls without proper JSON responseFormat
  ensureJsonResponseFormat(responseFormat, "Zhipu");

  if (!process.env.ZHIPU_API_KEY) {
    throw new Error("Zhipu API key not configured");
  }

  const { systemMsg, userMsg } = extractMessages(messages);
  console.log("[Zhipu] System message length:", systemMsg.length);
  console.log("[Zhipu] User message length:", userMsg.length);

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
      console.log(`[Zhipu] Attempt ${attempt + 1}/${maxRetries + 1}`);

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

      console.log("[Zhipu] Calling Zhipu API...");
      const response = await fetch(
        "https://api.z.ai/api/paas/v4/chat/completions",
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
        let errorMessage = response.statusText;
        try {
          const errorData = await response.json();
          errorMessage =
            errorData?.error?.message ||
            errorData?.message ||
            response.statusText ||
            "Unknown error";
        } catch {
          // If JSON parsing fails, try to get text response
          try {
            errorMessage = await response.text();
          } catch {
            errorMessage = response.statusText || "Unknown error";
          }
        }

        const error = new Error(errorMessage);
        error.status = response.status;
        throw error;
      }

      const data = await response.json();
      console.log("[Zhipu] Response received from Zhipu API");

      // Extract text from response
      const text = data?.choices?.[0]?.message?.content || "";
      console.log("[Zhipu] Response text length:", text.length);

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

      console.log("[Zhipu] Returning response from Zhipu API");
      return {
        content: parsed,
        text,
        ...(usage ? { usage } : {}),
        raw: data,
      };
    } catch (error) {
      lastError = error;
      const msg = error?.message || error?.toString() || "Unknown error";
      console.error("[Zhipu] Error occurred:", msg);
      console.error("[Zhipu] Error status:", error?.status);

      if (error.status === 401) throw error;

      if (isRetryableError(error) && attempt < maxRetries) {
        console.log("[Zhipu] Retrying due to retryable error");
        continue;
      }

      if (attempt === maxRetries) throw error;
    }
  }

  throw lastError || new Error(`Failed after ${maxRetries + 1} attempts`);
}
