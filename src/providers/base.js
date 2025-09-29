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
