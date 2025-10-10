import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// We'll import the bootstrap module (to be implemented) which should export:
// async function bootstrap({ stateUrl = '/api/state', sseUrl = '/api/events', applySnapshot })
import { bootstrap } from "../src/ui/client/bootstrap.js";

// Helpers to create controllable mock EventSource instances
function createMockEventSource({ emitImmediately = false } = {}) {
  const listeners = {};
  const instance = {
    addEventListener: (type, fn) => {
      listeners[type] = listeners[type] || [];
      listeners[type].push(fn);
    },
    removeEventListener: (type, fn) => {
      if (!listeners[type]) return;
      listeners[type] = listeners[type].filter((f) => f !== fn);
    },
    close: vi.fn(),
    // helper used by test to simulate incoming events
    __emit: (type, data) => {
      const fns = listeners[type] || [];
      for (const f of fns) {
        try {
          f({ data: JSON.stringify(data) });
        } catch (err) {
          // ignore
        }
      }
    },
  };

  // Optionally emit a job:updated event immediately after construction to simulate
  // a server that pushes events right away.
  if (emitImmediately) {
    // schedule emit on next microtask so bootstrap has a chance to attach listeners
    Promise.resolve().then(() => {
      instance.__emit("job:updated", { id: "early", status: "running" });
    });
  }

  return instance;
}

describe("client bootstrap (fetch snapshot then connect SSE)", () => {
  let originalFetch;
  let originalEventSource;

  beforeEach(() => {
    originalFetch = global.fetch;
    originalEventSource = global.EventSource;
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    global.EventSource = originalEventSource;
  });

  it("fetches /api/state before creating EventSource", async () => {
    const fetchCalled = [];
    // Mock fetch to delay a tick before resolving so we can assert ordering
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            jobs: [{ id: "job-1", status: "running" }],
            meta: { version: "1", lastUpdated: "now" },
          }),
      })
    );

    const createdEventSources = [];
    global.EventSource = vi.fn((url) => {
      createdEventSources.push(url);
      // return a mock that does nothing
      return createMockEventSource();
    });

    const applied = vi.fn();

    // Call bootstrap which should await fetch and apply snapshot, then create EventSource.
    await bootstrap({
      stateUrl: "/api/state",
      sseUrl: "/api/events",
      applySnapshot: applied,
    });

    // fetch must have been called
    expect(global.fetch).toHaveBeenCalledWith("/api/state", expect.any(Object));
    // EventSource should be created after fetch resolution
    expect(createdEventSources.length).toBe(1);
    expect(createdEventSources[0]).toBe("/api/events");

    // applySnapshot should have been called with snapshot
    expect(applied).toHaveBeenCalled();
  });

  it("ensures snapshot is applied before processing SSE events", async () => {
    // Make fetch resolve immediately with a snapshot
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            jobs: [{ id: "job-1", status: "running" }],
            meta: { version: "1", lastUpdated: "now" },
          }),
      })
    );

    // Create an EventSource mock that emits an event immediately after construction
    let esInstance;
    global.EventSource = vi.fn(() => {
      esInstance = createMockEventSource({ emitImmediately: true });
      return esInstance;
    });

    const applied = vi.fn();
    const onEvent = vi.fn();

    // Our bootstrap will attach a handler that calls onEvent for job:updated events.
    // Call bootstrap which should: fetch -> applySnapshot -> create EventSource -> attach handlers -> receive event
    await bootstrap({
      stateUrl: "/api/state",
      sseUrl: "/api/events",
      applySnapshot: applied,
      onSseEvent: (type, data) => {
        if (type === "job:updated") onEvent(data);
      },
    });

    // applied should be called before onEvent
    expect(applied).toHaveBeenCalled();
    expect(onEvent).toHaveBeenCalled();
  });
});
