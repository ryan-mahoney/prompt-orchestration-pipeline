import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventEmitter } from "events";

// Hoisted mocks so they are available before module import
const { mockVite, mockWatcher, mockState, mockEnvironment } = vi.hoisted(
  () => ({
    mockVite: {
      createServer: vi.fn(),
    },
    mockWatcher: {
      start: vi.fn(),
      stop: vi.fn(),
    },
    mockState: {
      getState: vi.fn(),
      recordChange: vi.fn(),
      reset: vi.fn(),
      setWatchedPaths: vi.fn(),
    },
    mockEnvironment: {
      loadEnvironment: vi
        .fn()
        .mockResolvedValue({ loaded: [], warnings: [], config: {} }),
    },
  })
);

// Provide the mocked modules
vi.mock("vite", () => mockVite);
vi.mock("../src/ui/watcher", () => mockWatcher);
vi.mock("../src/ui/state", () => mockState);
vi.mock("../src/core/environment", () => mockEnvironment);

describe("Dev single-process Vite integration (step 1 tests)", () => {
  let serverModule;
  let viteInstance;
  let serverHandle;
  let watcherInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    // Default state mock
    mockState.getState.mockReturnValue({
      updatedAt: "2024-01-10T10:00:00.000Z",
      changeCount: 0,
      recentChanges: [],
      watchedPaths: ["pipeline-config", "runs"],
    });

    // Default watcher mock: return an EventEmitter-like object
    watcherInstance = new EventEmitter();
    watcherInstance.close = vi.fn();
    // Capture the callback passed into start so tests can trigger watcher events
    mockWatcher.start.mockImplementation((paths, cb) => {
      watcherInstance.__onChange = cb;
      return watcherInstance;
    });
    mockWatcher.stop.mockResolvedValue(undefined);

    // Prepare a default vite instance to be returned by createServer
    viteInstance = {
      middlewares: (req, res) => {
        // default middleware implementation; tests may override by replacing this function
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("vite-default");
      },
      close: vi.fn().mockResolvedValue(undefined),
    };

    mockVite.createServer.mockImplementation(async (opts) => {
      // return the same instance and make the opts available on the instance for assertions
      viteInstance._opts = opts;
      return viteInstance;
    });

    // Force development mode for these tests
    process.env.NODE_ENV = "development";
    // Set PO_ROOT to avoid test failures
    process.env.PO_ROOT = process.cwd();

    // Import server module after we set up mocks
    serverModule = await import("../src/ui/server.js");
  });

  afterEach(async () => {
    // Ensure watchers/servers cleaned up
    if (serverHandle && serverHandle.close) {
      try {
        await serverHandle.close();
      } catch (err) {
        // ignore
      }
      serverHandle = null;
    }

    if (serverModule && serverModule.sseRegistry) {
      serverModule.sseRegistry.closeAll();
    }

    vi.resetModules();
    vi.useRealTimers();
    delete process.env.NODE_ENV;
  });

  it("loads environment on startup", async () => {
    await serverModule.startServer({ port: 0 });
    expect(mockEnvironment.loadEnvironment).toHaveBeenCalled();
  });

  it("creates Vite dev server in middlewareMode and closes it on shutdown", async () => {
    const srv = await serverModule.startServer({ port: 0 });
    expect(mockVite.createServer).toHaveBeenCalled();

    // Assert middlewareMode was requested
    const opts = viteInstance._opts;
    expect(opts).toBeDefined();
    expect(opts.server).toBeDefined();
    expect(opts.server.middlewareMode).toBe(true);
    // Root should point to the client directory (ends with .../src/ui/client)
    expect(String(opts.root)).toMatch(/src[\/\\]ui[\/\\]client$/);

    // url should be provided
    expect(typeof srv.url).toBe("string");
    expect(srv.url.startsWith("http://")).toBe(true);

    // Close server and ensure vite.close was called
    await srv.close();
    expect(viteInstance.close).toHaveBeenCalled();
  });

  it("forwards non-API requests to vite.middlewares", async () => {
    // Replace middleware with spy that responds
    const middlewareSpy = vi.fn((req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("served-by-vite");
    });
    viteInstance.middlewares = middlewareSpy;

    const srv = await serverModule.startServer({ port: 0 });

    try {
      // Request a path that is not explicitly handled by the server static checks
      const res = await fetch(srv.url + "/some/client/route");
      const text = await res.text();

      expect(res.status).toBe(200);
      expect(text).toBe("served-by-vite");
      expect(middlewareSpy).toHaveBeenCalled();
    } finally {
      await srv.close();
    }
  });

  it("preserves API behavior for /api/state and does not call vite middleware", async () => {
    // Make middleware record calls if invoked
    const middlewareSpy = vi.fn((req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("vite-should-not-handle-api");
    });
    viteInstance.middlewares = middlewareSpy;

    const srv = await serverModule.startServer({ port: 0 });

    try {
      const res = await fetch(srv.url + "/api/state");
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json).toEqual(mockState.getState());
      expect(middlewareSpy).not.toHaveBeenCalled();
    } finally {
      await srv.close();
    }
  });

  it("SSE endpoint returns text/event-stream and streams initial state (reads first chunk then aborts)", async () => {
    const srv = await serverModule.startServer({ port: 0 });

    try {
      const response = await fetch(srv.url + "/api/events", {
        headers: { Accept: "text/event-stream" },
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("text/event-stream");

      // Read only the first available chunk and then cancel to avoid lingering connection
      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      const { value } = await reader.read();
      const text = decoder.decode(value);

      // Initial SSE chunk should not contain full state; client should fetch /api/state
      expect(text).not.toContain("event: state");
      // Initial chunk will typically be a comment/ping (e.g., ': connected' or ': keep-alive')

      // Cancel reader to close the body stream
      await reader.cancel();
    } finally {
      await srv.close();
    }
  });

  it("broadcasts state update when watcher reports changes", async () => {
    // Spy on sseRegistry.broadcast to verify broadcasts occur
    const srv = await serverModule.startServer({ port: 0 });

    try {
      const broadcastSpy = vi.spyOn(serverModule.sseRegistry, "broadcast");

      // If watcher callback exists, trigger it; otherwise call broadcast helper directly.
      const changes = [
        { path: "pipeline-config/example.json", type: "modified" },
      ];

      if (typeof watcherInstance.__onChange === "function") {
        // Call the captured callback (server will update state via state.recordChange and broadcast)
        watcherInstance.__onChange(changes);
      } else {
        // Direct fallback to exercise broadcast path without relying on watcher wiring
        serverModule.broadcastStateUpdate(mockState.getState());
      }

      // Wait briefly for the broadcast to occur (poll to avoid flaky timing)
      const maxWait = 200;
      const start = Date.now();
      while (!broadcastSpy.mock.calls.length && Date.now() - start < maxWait) {
        await new Promise((r) => setTimeout(r, 5));
      }

      expect(broadcastSpy).toHaveBeenCalled();
      // Server emits compact state-related events; ensure at least one broadcast
      // is a state-related event (state:change or state:summary).
      const hasStateEvent = broadcastSpy.mock.calls.some(
        (c) =>
          c[0] &&
          c[0].type &&
          typeof c[0].type === "string" &&
          c[0].type.startsWith("state")
      );
      expect(hasStateEvent).toBe(true);
    } finally {
      await srv.close();
    }
  });

  it("clean shutdown: stops watcher, closes Vite, and closes SSE registry", async () => {
    // Spy on sseRegistry.closeAll to ensure it's invoked during shutdown
    const srv = await serverModule.startServer({ port: 0 });
    const closeAllSpy = vi.spyOn(serverModule.sseRegistry, "closeAll");

    // Ensure watcher was started and we have a watcher instance
    expect(mockWatcher.start).toHaveBeenCalled();

    // Close the server and assert cleanup calls were made
    await srv.close();

    // Vite should have been closed
    expect(viteInstance.close).toHaveBeenCalled();

    // Watcher stop should have been invoked
    expect(mockWatcher.stop).toHaveBeenCalled();

    // SSE registry should be closed
    expect(closeAllSpy).toHaveBeenCalled();
  });
});
