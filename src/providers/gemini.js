import {
  extractMessages,
  isRetryableError,
  sleep,
  stripMarkdownFences,
  tryParseJSON,
  ensureJsonResponseFormat,
  ProviderJsonParseError,
} from "./base.js";

/**
 * Google Gemini provider implementation
 *
 * @param {Object} options - Provider options
 * @param {Array} options.messages - Message array with system and user roles
 * @param {string} options.model - Model name (default: "gemini-2.5-flash")
 * @param {number} options.temperature - Temperature for sampling (default: 0.7)
 * @param {number} options.maxTokens - Maximum tokens in response
 * @param {string|Object} options.responseFormat - Response format ("json" or schema object)
 * @param {number} options.topP - Top-p sampling parameter
 * @param {string} options.stop - Stop sequence
 * @param {number} options.maxRetries - Maximum retry attempts (default: 3)
 * @returns {Promise<Object>} Provider response with content, text, usage, and raw response
 */
export async function geminiChat(options) {
  const {
    messages,
    model = "gemini-2.5-flash",
    temperature = 0.7,
    maxTokens,
    responseFormat,
    topP,
    frequencyPenalty,
    presencePenalty,
    stop,
    maxRetries = 3,
  } = options;

  // Validate response format (Gemini only supports JSON mode)
  ensureJsonResponseFormat(responseFormat, "Gemini");

  // Check API key
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("Gemini API key not configured");
  }

  // Extract system and user messages
  const { systemMsg, userMsg } = extractMessages(messages);

  // Build system instruction for JSON enforcement
  let systemInstruction = systemMsg;
  if (responseFormat === "json" || responseFormat?.type === "json_object") {
    systemInstruction = `${systemMsg}\n\nYou must output strict JSON only with no extra text.`;
  }
  if (responseFormat?.json_schema) {
    systemInstruction = `${systemMsg}\n\nYou must output strict JSON only matching this schema (no extra text):\n${JSON.stringify(responseFormat.json_schema)}`;
  }

  // Prepare request body
  const requestBody = {
    contents: [
      {
        parts: [
          {
            text: userMsg,
          },
        ],
      },
    ],
    generationConfig: {
      temperature,
      maxOutputTokens: maxTokens,
      topP,
      stopSequences: stop ? [stop] : undefined,
    },
    safetySettings: [
      {
        category: "HARM_CATEGORY_HARASSMENT",
        threshold: "BLOCK_NONE",
      },
      {
        category: "HARM_CATEGORY_HATE_SPEECH",
        threshold: "BLOCK_NONE",
      },
      {
        category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
        threshold: "BLOCK_NONE",
      },
      {
        category: "HARM_CATEGORY_DANGEROUS_CONTENT",
        threshold: "BLOCK_NONE",
      },
    ],
  };

  // Add system instruction if provided
  if (systemInstruction.trim()) {
    requestBody.systemInstruction = {
      parts: [
        {
          text: systemInstruction,
        },
      ],
    };
  }

  // Remove undefined values
  if (topP === undefined) delete requestBody.generationConfig.topP;
  if (stop === undefined) delete requestBody.generationConfig.stopSequences;

  let lastError;
  const baseUrl =
    process.env.GEMINI_BASE_URL ||
    "https://generativelanguage.googleapis.com/v1beta";
  const url = `${baseUrl}/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      await sleep(2 ** attempt * 1000); // Exponential backoff
    }

    try {
      console.log(
        `[Gemini] Starting geminiChat call (attempt ${attempt + 1}/${maxRetries + 1})`
      );
      console.log(`[Gemini] Model: ${model}`);
      console.log(`[Gemini] Response format:`, responseFormat);
      console.log(
        `[Gemini] System instruction length: ${systemInstruction.length}`
      );
      console.log(`[Gemini] User message length: ${userMsg.length}`);

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const error = new Error(
          errorData.error?.message || `Gemini API error: ${response.statusText}`
        );
        error.status = response.status;
        error.data = errorData;

        // Don't retry on authentication errors
        if (response.status === 401) {
          throw error;
        }

        // Retry on retryable errors
        if (isRetryableError(error) && attempt < maxRetries) {
          console.log(`[Gemini] Retryable error, retrying...`);
          lastError = error;
          continue;
        }

        throw error;
      }

      const data = await response.json();
      console.log(
        `[Gemini] Response received, candidates length: ${data.candidates?.length || 0}`
      );

      // Extract text from response
      const candidate = data.candidates?.[0];
      if (!candidate?.content?.parts?.[0]?.text) {
        throw new Error("No content returned from Gemini API");
      }

      const rawText = candidate.content.parts[0].text;
      // Always strip markdown fences first to prevent parse failures
      const text = stripMarkdownFences(rawText);
      console.log(`[Gemini] Text length: ${text.length}`);

      // Parse JSON if required
      const parsed = tryParseJSON(text);
      if (responseFormat && !parsed) {
        throw new ProviderJsonParseError(
          "Gemini",
          model,
          text.substring(0, 200),
          "Failed to parse JSON response from Gemini API"
        );
      }

      // Normalize usage metrics
      const usage = data.usageMetadata
        ? {
            prompt_tokens: data.usageMetadata.promptTokenCount,
            completion_tokens: data.usageMetadata.candidatesTokenCount,
            total_tokens: data.usageMetadata.totalTokenCount,
          }
        : undefined;

      console.log(`[Gemini] Usage:`, usage);

      return {
        content: parsed || text,
        text,
        ...(usage ? { usage } : {}),
        raw: data,
      };
    } catch (error) {
      console.error(`[Gemini] Error occurred: ${error.message}`);
      console.error(`[Gemini] Error status: ${error.status}`);

      lastError = error;

      // Don't retry on authentication errors
      if (error.status === 401) {
        throw error;
      }

      // Continue retrying for other errors
      if (attempt < maxRetries) {
        continue;
      }

      throw lastError;
    }
  }

  throw lastError;
}
