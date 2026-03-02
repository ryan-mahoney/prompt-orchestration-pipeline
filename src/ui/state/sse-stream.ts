import type { SSEStreamResult } from "./types";

const encoder = new TextEncoder();
const KEEP_ALIVE_MS = 30_000;

function formatEvent(event: string, data: unknown): string {
  const payload = JSON.stringify(data);
  return `event: ${event}\ndata: ${payload}\n\n`;
}

export function createSSEStream(signal?: AbortSignal): SSEStreamResult {
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  let closed = false;
  let keepAlive: ReturnType<typeof setInterval> | null = null;

  const close = (): void => {
    if (closed) return;
    closed = true;
    if (keepAlive) {
      clearInterval(keepAlive);
      keepAlive = null;
    }
    controller?.close();
    controller = null;
  };

  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(nextController) {
        controller = nextController;
        keepAlive = setInterval(() => {
          if (closed || !controller) return;
          controller.enqueue(encoder.encode(": ping\n\n"));
        }, KEEP_ALIVE_MS);
      },
      cancel() {
        close();
      },
    }),
    {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    },
  );

  if (signal) {
    signal.addEventListener("abort", close, { once: true });
  }

  return {
    response,
    writer: {
      send(event, data) {
        if (closed || !controller) return;
        controller.enqueue(encoder.encode(formatEvent(event, data)));
      },
      close,
    },
  };
}
