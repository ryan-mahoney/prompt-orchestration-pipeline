import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventEmitter } from "events";

// Hoisted mocks so they are available before module import
const { mockVite, mockWatcher, mockState } = vi.hoisted(() => ({
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
}));

vi.mock("vite", () => mockVite);
vi.mock("../src/ui/watcher", () => mockWatcher);
vi.mock("../src/ui/state", () => mockState);

describe("Dev routing behavior with Vite middleware (step 1 tests)", () => {
  let serverModule;
  let viteInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    mockState.getState.mockReturnValue({
      updatedAt: "2024-01-10T10:00:00.000Z",
      changeCount: 0,
      recentChanges: [],
      watchedPaths: ["pipeline-config", "runs"],
    });

    const watcherInstance = new EventEmitter();
    watcherInstance.close = vi.fn();
    mockWatcher.start.mockReturnValue(watcherInstance);
    mockWatcher.stop.mockResolvedValue(undefined);

    viteInstance = {
      middlewares: (req, res) => {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("vite-default");
      },
      close: vi.fn().mockResolvedValue(undefined),
    };

    mockVite.createServer.mockImplementation(async (opts) => {
      viteInstance._opts = opts;
      return viteInstance;
    });

    process.env.NODE_ENV = "development";
    process.env.PO_ROOT = "/tmp/test"; // Set PO_ROOT for development mode
    serverModule = await import("../src/ui/server.js");
  });

  afterEach(async () => {
    // Close any sse clients
    if (serverModule && serverModule.sseRegistry) {
      serverModule.sseRegistry.closeAll();
    }

    vi.resetModules();
    vi.useRealTimers();
    delete process.env.NODE_ENV;
  });

  it("does not forward API requests to vite middleware (example: /api/jobs)", async () => {
    // Make vite middleware fail the test if called
    const middlewareSpy = vi.fn((req, res) => {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("vite-called");
    });
    viteInstance.middlewares = middlewareSpy;

    const srv = await serverModule.startServer({ port: 0 });

    try {
      const res = await fetch(srv.url + "/api/jobs");
      // Server currently returns JSON for /api/jobs (may be empty/mock), but must NOT be handled by vite
      expect(middlewareSpy).not.toHaveBeenCalled();
      expect(res.headers.get("content-type")).toBe("application/json");
    } finally {
      await srv.close();
    }
  });

  it("forwards unknown non-API paths to vite middleware (client-side routing)", async () => {
    const middlewareSpy = vi.fn((req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("vite-served-route");
    });
    viteInstance.middlewares = middlewareSpy;

    const srv = await serverModule.startServer({ port: 0 });

    try {
      const res = await fetch(srv.url + "/some/client/route");
      const text = await res.text();

      expect(res.status).toBe(200);
      expect(text).toBe("vite-served-route");
      expect(middlewareSpy).toHaveBeenCalled();
    } finally {
      await srv.close();
    }
  });

  it("serves assets via vite middleware when requested (e.g., /assets/app.js)", async () => {
    const middlewareSpy = vi.fn((req, res) => {
      // Simulate Vite serving an asset
      if (req.url && req.url.includes("/assets/app.js")) {
        res.writeHead(200, { "Content-Type": "application/javascript" });
        res.end('console.log("from-vite");');
      } else {
        res.writeHead(404);
        res.end("not-found");
      }
    });
    viteInstance.middlewares = middlewareSpy;

    const srv = await serverModule.startServer({ port: 0 });

    try {
      const res = await fetch(srv.url + "/assets/app.js");
      const text = await res.text();

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("application/javascript");
      expect(text).toContain('console.log("from-vite")');
      expect(middlewareSpy).toHaveBeenCalled();
    } finally {
      await srv.close();
    }
  });
});

describe("SSE endpoint with jobId filtering", () => {
  let serverModule;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    process.env.NODE_ENV = "development";
    process.env.PO_ROOT = "/tmp/test"; // Set PO_ROOT for development mode
    serverModule = await import("../src/ui/server.js");
  });

  afterEach(async () => {
    // Close any sse clients
    if (serverModule && serverModule.sseRegistry) {
      serverModule.sseRegistry.closeAll();
    }

    vi.resetModules();
    vi.useRealTimers();
    delete process.env.NODE_ENV;
  });

  it("should accept SSE connections with jobId query parameter", async () => {
    const srv = await serverModule.startServer({ port: 0 });

    try {
      const response = await fetch(srv.url + "/api/events?jobId=job-123", {
        headers: {
          Accept: "text/event-stream",
          "Cache-Control": "no-cache",
        },
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("text/event-stream");
      expect(response.headers.get("cache-control")).toBe("no-cache");
      expect(response.headers.get("connection")).toBe("keep-alive");

      // Should have added client to registry with jobId
      expect(serverModule.sseRegistry.getClientCount()).toBe(1);
    } finally {
      await srv.close();
    }
  });

  it("should accept SSE connections without jobId for backward compatibility", async () => {
    const srv = await serverModule.startServer({ port: 0 });

    try {
      const response = await fetch(srv.url + "/api/events", {
        headers: {
          Accept: "text/event-stream",
          "Cache-Control": "no-cache",
        },
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("text/event-stream");

      // Should have added client to registry without jobId
      expect(serverModule.sseRegistry.getClientCount()).toBe(1);
    } finally {
      await srv.close();
    }
  });

  it("should parse jobId from query string correctly", async () => {
    const srv = await serverModule.startServer({ port: 0 });

    try {
      const response = await fetch(
        srv.url + "/api/events?jobId=test-job-456&other=value",
        {
          headers: {
            Accept: "text/event-stream",
            "Cache-Control": "no-cache",
          },
        }
      );

      expect(response.status).toBe(200);
      expect(serverModule.sseRegistry.getClientCount()).toBe(1);

      // The registry should have stored the client with the correct jobId
      // This is tested indirectly through the SSE filtering functionality
      // which is covered in sse-filtering.test.js
    } finally {
      await srv.close();
    }
  });

  it("should handle malformed query parameters gracefully", async () => {
    const srv = await serverModule.startServer({ port: 0 });

    try {
      const response = await fetch(srv.url + "/api/events?invalid-query", {
        headers: {
          Accept: "text/event-stream",
          "Cache-Control": "no-cache",
        },
      });

      expect(response.status).toBe(200);
      expect(serverModule.sseRegistry.getClientCount()).toBe(1);
    } finally {
      await srv.close();
    }
  });
});
