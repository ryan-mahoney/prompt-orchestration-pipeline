import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchSSE, parseSSEEvent } from "../sse-fetch";

const originalFetch = globalThis.fetch;

function makeStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function flushAsyncWork(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("sse fetch", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("parses valid event blocks", () => {
    expect(parseSSEEvent('event: started\ndata: {"ok":true}')).toEqual({
      type: "started",
      data: { ok: true },
    });
  });

  it("returns null for missing fields or invalid JSON", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(parseSSEEvent('data: {"ok":true}')).toBeNull();
    expect(parseSSEEvent("event: started")).toBeNull();
    expect(parseSSEEvent("event: started\ndata: nope")).toBeNull();
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("throws when onEvent is not a function", () => {
    expect(() => fetchSSE("/api/test", undefined, null as never)).toThrow(
      "fetchSSE requires an onEvent callback",
    );
  });

  it("streams parsed events to onEvent", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        makeStream(['event: started\ndata: {"task":"a"}\n\n', 'event: complete\ndata: {"ok":true}\n\n']),
        { status: 200 },
      ),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const onEvent = vi.fn();

    fetchSSE("/api/test", { method: "POST" }, onEvent);
    await flushAsyncWork();

    expect(onEvent).toHaveBeenNthCalledWith(1, "started", { task: "a" });
    expect(onEvent).toHaveBeenNthCalledWith(2, "complete", { ok: true });
  });

  it("calls onError for non-2xx responses", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ message: "bad" }), { status: 500 }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const onError = vi.fn();

    fetchSSE("/api/test", undefined, vi.fn(), onError);
    await flushAsyncWork();

    expect(onError).toHaveBeenCalledWith({ message: "bad" });
  });

  it("silently swallows abort errors on cancel", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      const signal = init?.signal as AbortSignal;
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const onError = vi.fn();

    const handle = fetchSSE("/api/test", undefined, vi.fn(), onError);
    handle.cancel();
    await flushAsyncWork();

    expect(onError).not.toHaveBeenCalled();
  });
});
