import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createSSEStream } from "../sse-stream";

interface ReaderLike {
  read(): Promise<{ done: boolean; value?: unknown }>;
}

async function readChunk(reader: ReaderLike): Promise<string | null> {
  const result = await reader.read();
  return result.done ? null : new TextDecoder().decode(result.value as Uint8Array);
}

describe("sse-stream", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns an SSE response with correctly framed messages", async () => {
    const { response, writer } = createSSEStream();
    const reader = response.body!.getReader();

    writer.send("status", { ok: true });

    expect(response.headers.get("Content-Type")).toBe("text/event-stream");
    expect(response.headers.get("Cache-Control")).toBe("no-cache");
    expect(response.headers.get("Connection")).toBe("keep-alive");
    await expect(readChunk(reader)).resolves.toBe('event: status\ndata: {"ok":true}\n\n');
  });

  it("emits keep-alive pings and closes cleanly", async () => {
    const { response, writer } = createSSEStream();
    const reader = response.body!.getReader();

    vi.advanceTimersByTime(30_000);
    await Promise.resolve();
    await expect(readChunk(reader)).resolves.toBe(": ping\n\n");

    writer.close();
    await expect(readChunk(reader)).resolves.toBeNull();
  });

  it("stops sending after abort without throwing", async () => {
    const controller = new AbortController();
    const { response, writer } = createSSEStream(controller.signal);
    const reader = response.body!.getReader();

    controller.abort();
    writer.send("status", { ok: true });

    await expect(readChunk(reader)).resolves.toBeNull();
  });
});
