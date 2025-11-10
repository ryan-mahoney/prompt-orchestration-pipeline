import {
  extractMessages,
  isRetryableError,
  sleep,
  tryParseJSON,
  ensureJsonResponseFormat,
  ProviderJsonParseError,
} from "./base.js";

export async function anthropicChat({
  messages,
  model = "claude-3-sonnet",
  temperature = 0.7,
  maxTokens,
  responseFormat = "json",
  topP,
  stop,
  maxRetries = 3,
}) {
  console.log("\n[Anthropic] Starting anthropicChat call");
  console.log("[Anthropic] Model:", model);
  console.log("[Anthropic] Response format:", responseFormat);

  // Enforce JSON mode - reject calls without proper JSON responseFormat
  ensureJsonResponseFormat(responseFormat, "Anthropic");

  const { systemMsg, userMsg } = extractMessages(messages);
  console.log("[Anthropic] System message length:", systemMsg.length);
  console.log("[Anthropic] User message length:", userMsg.length);

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
      console.log(`[Anthropic] Attempt ${attempt + 1}/${maxRetries + 1}`);

      const requestBody = {
        model,
        system,
        messages: [{ role: "user", content: userMsg }],
        temperature,
        max_tokens: maxTokens,
        ...(topP !== undefined ? { top_p: topP } : {}),
        ...(stop !== undefined ? { stop_sequences: stop } : {}),
      };

      console.log("[Anthropic] Calling Anthropic API...");
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
        const error = await response
          .json()
          .catch(() => ({ error: response.statusText }));
        throw { status: response.status, ...error };
      }

      const data = await response.json();
      console.log("[Anthropic] Response received from Anthropic API");

      // Extract text from response.content blocks
      const blocks = Array.isArray(data?.content) ? data.content : [];
      const text = blocks
        .filter((b) => b?.type === "text" && typeof b.text === "string")
        .map((b) => b.text)
        .join("");
      console.log("[Anthropic] Response text length:", text.length);

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

      console.log("[Anthropic] Returning response from Anthropic API");
      return {
        content: parsed,
        text,
        ...(usage ? { usage } : {}),
        raw: data,
      };
    } catch (error) {
      lastError = error;
      const msg = error?.error?.message || error?.message || "";
      console.error("[Anthropic] Error occurred:", msg);
      console.error("[Anthropic] Error status:", error?.status);

      if (error.status === 401) throw error;

      if (isRetryableError(error) && attempt < maxRetries) {
        console.log("[Anthropic] Retrying due to retryable error");
        continue;
      }

      if (attempt === maxRetries) throw error;
    }
  }

  throw lastError || new Error(`Failed after ${maxRetries + 1} attempts`);
}
