import type {
  ParsedSseEvent,
  SseErrorCallback,
  SseEventCallback,
  SseFetchHandle,
} from "./types";

export function parseSSEEvent(eventText: string): ParsedSseEvent | null {
  const lines = eventText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");

  let type: string | null = null;
  const dataLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith("event:")) type = line.slice(6).trim();
    if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }

  if (type === null || dataLines.length === 0) return null;

  try {
    return {
      type,
      data: JSON.parse(dataLines.join("\n")),
    };
  } catch (error) {
    console.warn("Failed to parse SSE event JSON", error);
    return null;
  }
}

export function fetchSSE(
  url: string,
  options: RequestInit | undefined,
  onEvent: SseEventCallback,
  onError?: SseErrorCallback,
): SseFetchHandle {
  if (typeof onEvent !== "function") {
    throw new TypeError("fetchSSE requires an onEvent callback");
  }

  const controller = new AbortController();

  void (async () => {
    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        if (onError) onError(errorData);
        else console.error("SSE request failed", errorData);
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });

        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";

        for (const part of parts) {
          const event = parseSSEEvent(part);
          if (event === null) continue;
          onEvent(event.type, event.data);
        }
      }

      const trailing = parseSSEEvent(buffer);
      if (trailing !== null) onEvent(trailing.type, trailing.data);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      throw error;
    }
  })().catch((error) => {
    if (error instanceof DOMException && error.name === "AbortError") return;
    if (onError) onError(error);
    else console.error(error);
  });

  return {
    cancel: () => controller.abort(),
  };
}
