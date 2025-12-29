/**
 * Parse Server-Sent Events from a fetch response stream.
 * Supports POST requests (unlike native EventSource).
 *
 * @param {string} url - The URL to fetch
 * @param {RequestInit} options - Fetch options (method defaults to POST)
 * @param {function} onEvent - Callback for each SSE event: (eventName, parsedData) => void
 * @param {function} onError - Callback for HTTP errors: (errorData) => void
 * @returns {{ cancel: () => void }} Object with cancel method to abort the fetch
 */
export function fetchSSE(url, options = {}, onEvent, onError) {
  if (typeof onEvent !== "function") {
    throw new Error("onEvent callback is required");
  }

  const controller = new AbortController();
  const requestOptions = {
    method: "POST",
    ...options,
    signal: controller.signal,
  };

  fetch(url, requestOptions)
    .then(async (response) => {
      // Handle HTTP errors before attempting to read stream
      if (!response.ok) {
        let errorData = {};
        try {
          errorData = await response.json();
        } catch {
          // If response isn't JSON, just use status text
          errorData = {
            ok: false,
            code: "http_error",
            message: response.statusText,
            status: response.status,
          };
        }
        if (typeof onError === "function") {
          onError(errorData);
        } else {
          console.error(`[sse-fetch] HTTP ${response.status}:`, errorData);
        }
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");

        // Keep the last partial event in the buffer
        buffer = events.pop();

        for (const eventText of events) {
          if (!eventText.trim()) continue;

          const event = parseSSEEvent(eventText);
          if (event) {
            onEvent(event.type, event.data);
          }
        }
      }

      // Process any remaining content in buffer
      if (buffer.trim()) {
        const event = parseSSEEvent(buffer);
        if (event) {
          onEvent(event.type, event.data);
        }
      }
    })
    .catch((error) => {
      if (error.name === "AbortError") {
        return; // Expected when cancel() is called
      }
      console.error("[sse-fetch] Error:", error);
    });

  return {
    cancel: () => controller.abort(),
  };
}

/**
 * Parse a single SSE event string.
 *
 * @param {string} eventText - The raw SSE event text
 * @returns {{ type: string, data: object }|null} Parsed event or null if invalid
 */
function parseSSEEvent(eventText) {
  let type = null;
  let data = null;

  for (const line of eventText.split("\n")) {
    const trimmedLine = line.trim();
    if (trimmedLine.startsWith("event:")) {
      type = trimmedLine.slice(6).trim();
    } else if (trimmedLine.startsWith("data:")) {
      const dataStr = trimmedLine.slice(5).trim();
      try {
        data = JSON.parse(dataStr);
      } catch {
        console.error("[sse-fetch] Failed to parse data:", dataStr);
      }
    }
  }

  if (!type || data === null) {
    return null;
  }

  return { type, data };
}
