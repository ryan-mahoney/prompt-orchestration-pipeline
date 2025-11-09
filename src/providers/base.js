// Shared utilities for all providers

export function extractMessages(messages = []) {
  const systemMsg = messages.find((m) => m.role === "system")?.content || "";
  const userMessages = messages.filter((m) => m.role === "user");
  const assistantMessages = messages.filter((m) => m.role === "assistant");
  const userMsg = userMessages.map((m) => m.content).join("\n");

  return { systemMsg, userMsg, userMessages, assistantMessages };
}

export function isRetryableError(err) {
  const msg = err?.error?.message || err?.message || String(err || "");
  const status = err?.status ?? err?.code;

  // Network errors
  if (
    err?.code === "ECONNRESET" ||
    err?.code === "ENOTFOUND" ||
    err?.code === "ETIMEDOUT" ||
    err?.code === "ECONNREFUSED" ||
    /network|timeout|connection|socket|protocol|read ECONNRESET/i.test(msg)
  )
    return true;

  // HTTP errors that should be retried
  if ([429, 500, 502, 503, 504].includes(Number(status))) return true;

  return false;
}

export async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function tryParseJSON(text) {
  try {
    return JSON.parse(text);
  } catch {
    // Try to extract JSON from markdown code blocks
    const cleaned = text.replace(/```json\n?|\n?```/g, "").trim();
    try {
      return JSON.parse(cleaned);
    } catch {
      // Try to find first complete JSON object or array
      const startObj = cleaned.indexOf("{");
      const endObj = cleaned.lastIndexOf("}");
      const startArr = cleaned.indexOf("[");
      const endArr = cleaned.lastIndexOf("]");

      let s = -1,
        e = -1;
      if (startObj !== -1 && endObj > startObj) {
        s = startObj;
        e = endObj;
      } else if (startArr !== -1 && endArr > startArr) {
        s = startArr;
        e = endArr;
      }

      if (s !== -1 && e > s) {
        try {
          return JSON.parse(cleaned.slice(s, e + 1));
        } catch {
          return null;
        }
      }
      return null;
    }
  }
}

/**
 * Error thrown when JSON response format is required but not provided
 */
export class ProviderJsonModeError extends Error {
  constructor(providerName, message) {
    super(message);
    this.name = "ProviderJsonModeError";
    this.provider = providerName;
  }
}

/**
 * Error thrown when JSON parsing fails and should not be retried
 */
export class ProviderJsonParseError extends Error {
  constructor(provider, model, sample, message = "Failed to parse JSON response") {
    super(message);
    this.name = "ProviderJsonParseError";
    this.provider = provider;
    this.model = model;
    this.sample = sample;
  }
}

/**
 * Ensures that responseFormat is configured for JSON output
 * @param {*} responseFormat - The response format object or string
 * @param {string} providerName - Name of the provider for error reporting
 * @throws {ProviderJsonModeError} When JSON format is not properly configured
 */
export function ensureJsonResponseFormat(responseFormat, providerName) {
  if (!responseFormat) {
    throw new ProviderJsonModeError(
      providerName,
      `${providerName} requires responseFormat to be set for JSON mode`
    );
  }

  // Check for valid JSON format types
  const isValidJsonFormat = 
    responseFormat === "json" ||
    responseFormat?.type === "json_object" ||
    responseFormat?.type === "json_schema";

  if (!isValidJsonFormat) {
    throw new ProviderJsonModeError(
      providerName,
      `${providerName} only supports JSON response format. Got: ${JSON.stringify(responseFormat)}`
    );
  }
}
