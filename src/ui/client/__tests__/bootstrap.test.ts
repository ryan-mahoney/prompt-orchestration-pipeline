import { afterEach, describe, expect, it, vi } from "vitest";

import { bootstrap } from "../bootstrap";

const originalFetch = globalThis.fetch;
const originalEventSource = globalThis.EventSource;

class MockEventSource {
  public readonly addEventListener = vi.fn();

  constructor(public readonly url: string) {}
}

describe("bootstrap", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    globalThis.EventSource = originalEventSource;
    vi.restoreAllMocks();
  });

  it("applies the snapshot before opening the event source", async () => {
    const applySnapshot = vi.fn(async () => undefined);
    const eventSourceCtor = vi.fn((url: string) => new MockEventSource(url));
    globalThis.fetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    ) as unknown as typeof fetch;
    globalThis.EventSource = eventSourceCtor as unknown as typeof EventSource;

    await bootstrap({ applySnapshot });

    expect(applySnapshot).toHaveBeenCalledWith({ ok: true });
    expect(eventSourceCtor).toHaveBeenCalledTimes(1);
    const applyOrder = applySnapshot.mock.invocationCallOrder[0];
    const eventSourceOrder = eventSourceCtor.mock.invocationCallOrder[0];
    expect(applyOrder).toBeDefined();
    expect(eventSourceOrder).toBeDefined();
    expect(applyOrder!).toBeLessThan(eventSourceOrder!);
  });

  it("calls applySnapshot(null) on fetch failure and still returns an event source", async () => {
    const applySnapshot = vi.fn();
    const instance = new MockEventSource("/api/events");
    globalThis.fetch = vi.fn<typeof fetch>().mockRejectedValue(new Error("offline")) as unknown as typeof fetch;
    globalThis.EventSource = vi.fn(() => instance) as unknown as typeof EventSource;

    const result = await bootstrap({ applySnapshot });

    expect(applySnapshot).toHaveBeenCalledWith(null);
    expect(result).toBe(instance);
  });

  it("passes through non-ok json responses", async () => {
    const applySnapshot = vi.fn();
    globalThis.fetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ error: "bad" }), { status: 500 }),
    ) as unknown as typeof fetch;
    globalThis.EventSource = vi.fn((url: string) => new MockEventSource(url)) as unknown as typeof EventSource;

    await bootstrap({ applySnapshot });

    expect(applySnapshot).toHaveBeenCalledWith({ error: "bad" });
  });

  it("passes null for unparseable responses", async () => {
    const applySnapshot = vi.fn();
    globalThis.fetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("oops", { status: 500 }),
    ) as unknown as typeof fetch;
    globalThis.EventSource = vi.fn((url: string) => new MockEventSource(url)) as unknown as typeof EventSource;

    await bootstrap({ applySnapshot });

    expect(applySnapshot).toHaveBeenCalledWith(null);
  });

  it("returns null when event source construction fails", async () => {
    globalThis.fetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    ) as unknown as typeof fetch;
    globalThis.EventSource = vi.fn(() => {
      throw new Error("boom");
    }) as unknown as typeof EventSource;

    await expect(bootstrap()).resolves.toBeNull();
  });

  it("registers all bootstrap event listeners", async () => {
    const instance = new MockEventSource("/api/events");
    globalThis.fetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    ) as unknown as typeof fetch;
    globalThis.EventSource = vi.fn(() => instance) as unknown as typeof EventSource;

    await bootstrap();

    expect(instance.addEventListener).toHaveBeenCalledTimes(6);
    expect(instance.addEventListener.mock.calls.map(([name]) => name)).toEqual([
      "state",
      "job:updated",
      "job:created",
      "job:removed",
      "heartbeat",
      "message",
    ]);
  });
});
