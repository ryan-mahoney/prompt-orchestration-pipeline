import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createSSERegistry } from "../sse-registry";

interface MockController {
  chunks: string[];
  enqueue: (chunk: Uint8Array) => void;
  close: () => void;
  closeCalls: number;
}

function createController(shouldThrow = false): MockController {
  const chunks: string[] = [];
  return {
    chunks,
    closeCalls: 0,
    enqueue(chunk) {
      if (shouldThrow) throw new Error("dead");
      chunks.push(new TextDecoder().decode(chunk));
    },
    close() {
      this.closeCalls += 1;
    },
  };
}

describe("sse-registry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("adds, removes, broadcasts, and closes clients", () => {
    const registry = createSSERegistry({ heartbeatMs: 100, sendInitialPing: true });
    const signal = new AbortController();
    const controller = createController() as unknown as ReadableStreamDefaultController<Uint8Array>;

    registry.addClient(controller, signal.signal);
    expect(registry.getClientCount()).toBe(1);
    registry.broadcast({ type: "test", data: { msg: "hi" } });
    expect((controller as unknown as MockController).chunks.at(-1)).toBe(
      'event: test\ndata: {"msg":"hi"}\n\n',
    );

    registry.removeClient(controller);
    expect(registry.getClientCount()).toBe(0);
    expect((controller as unknown as MockController).closeCalls).toBe(0);
    registry.closeAll();
  });

  it("filters by job id and cleans up dead clients", () => {
    const registry = createSSERegistry({ heartbeatMs: 100 });
    const signal = new AbortController();
    const matching = createController() as unknown as ReadableStreamDefaultController<Uint8Array>;
    const filtered = createController() as unknown as ReadableStreamDefaultController<Uint8Array>;
    const dead = createController(true) as unknown as ReadableStreamDefaultController<Uint8Array>;

    registry.addClient(matching, signal.signal, { jobId: "job-1" });
    registry.addClient(filtered, signal.signal, { jobId: "job-2" });
    registry.addClient(dead, signal.signal);

    registry.broadcast("state", { jobId: "job-1", ok: true });
    expect((matching as unknown as MockController).chunks.at(-1)).toContain('"jobId":"job-1"');
    expect((filtered as unknown as MockController).chunks).toHaveLength(0);
    expect(registry.getClientCount()).toBe(2);
    expect((dead as unknown as MockController).closeCalls).toBe(0);
  });

  it("sends heartbeats while clients are connected", () => {
    const registry = createSSERegistry({ heartbeatMs: 100 });
    const controller = createController() as unknown as ReadableStreamDefaultController<Uint8Array>;
    registry.addClient(controller, new AbortController().signal);
    vi.advanceTimersByTime(100);
    expect((controller as unknown as MockController).chunks.at(-1)).toBe(": keep-alive\n\n");
  });

  it("closes streams when the server shuts down", () => {
    const registry = createSSERegistry({ heartbeatMs: 100 });
    const controller = createController() as unknown as ReadableStreamDefaultController<Uint8Array>;

    registry.addClient(controller, new AbortController().signal);
    registry.closeAll();

    expect((controller as unknown as MockController).closeCalls).toBe(1);
    expect(registry.getClientCount()).toBe(0);
  });
});
