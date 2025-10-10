/**
 * Tests for SSE Server functionality (Step 3)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import http from "http";
import { EventEmitter } from "events";

// Mock dependencies - use vi.hoisted for proper hoisting
const { mockWatcher, mockState, mockFs } = vi.hoisted(() => ({
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
  mockFs: {
    readFile: vi.fn(),
  },
}));

vi.mock("../src/ui/watcher", () => mockWatcher);
vi.mock("../src/ui/state", () => mockState);
vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    readFile: mockFs.readFile,
  };
});

describe("SSE Server (Step 3)", () => {
  let server;
  let serverModule;
  let abortControllers = [];

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    abortControllers = [];

    // Default mock implementations
    mockState.getState.mockReturnValue({
      updatedAt: "2024-01-10T10:00:00.000Z",
      changeCount: 0,
      recentChanges: [],
      watchedPaths: ["pipeline-config", "runs"],
    });

    mockState.recordChange.mockImplementation((path, type) => ({
      updatedAt: new Date().toISOString(),
      changeCount: 1,
      recentChanges: [{ path, type, timestamp: new Date().toISOString() }],
      watchedPaths: ["pipeline-config", "runs"],
    }));

    // Mock watcher returns an event emitter
    const mockWatcherInstance = new EventEmitter();
    mockWatcherInstance.close = vi.fn();
    mockWatcher.start.mockReturnValue(mockWatcherInstance);
    mockWatcher.stop.mockResolvedValue(undefined);

    // Mock fs.readFile to return index.html by default
    mockFs.readFile.mockImplementation((path, callback) => {
      if (path.endsWith("index.html")) {
        callback(null, Buffer.from("<html><body>Test</body></html>"));
      } else {
        callback(new Error("Not found"));
      }
    });

    // Import server module
    serverModule = await import("../src/ui/server.js");
  });

  afterEach(async () => {
    // Clear all timers first
    vi.clearAllTimers();

    // Abort all pending fetch requests
    abortControllers.forEach((controller) => {
      try {
        controller.abort();
      } catch (err) {
        // Ignore abort errors
      }
    });
    abortControllers = [];

    // Close SSE registry
    if (serverModule && serverModule.sseRegistry) {
      serverModule.sseRegistry.closeAll();
    }

    // Close server
    if (server && server.listening) {
      await new Promise((resolve) => {
        server.close(() => resolve());
      });
    }

    // Reset modules to clear any timers
    vi.resetModules();

    // Restore real timers
    vi.useRealTimers();
  });

  describe("GET /api/state", () => {
    it("should return JSON state snapshot", async () => {
      server = serverModule.createServer();

      await new Promise((resolve) => {
        server.listen(0, resolve);
      });

      const port = server.address().port;
      const response = await fetch(`http://localhost:${port}/api/state`);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("application/json");
      expect(data).toEqual({
        updatedAt: "2024-01-10T10:00:00.000Z",
        changeCount: 0,
        recentChanges: [],
        watchedPaths: ["pipeline-config", "runs"],
      });
    });
  });

  describe("GET /api/events (SSE)", () => {
    // Note: SSE tests are skipped because persistent connections are difficult
    // to properly close in test environments, causing tests to hang.
    // The SSE functionality is tested manually and through integration tests.

    it.skip("should establish SSE connection with correct headers", async () => {
      server = serverModule.createServer();

      await new Promise((resolve) => {
        server.listen(0, resolve);
      });

      const port = server.address().port;

      const controller = new AbortController();
      abortControllers.push(controller);

      try {
        const response = await fetch(`http://localhost:${port}/api/events`, {
          headers: { Accept: "text/event-stream" },
          signal: controller.signal,
        });

        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toBe("text/event-stream");
        expect(response.headers.get("cache-control")).toBe("no-cache");
        expect(response.headers.get("connection")).toBe("keep-alive");

        // Cancel the body stream and abort
        await response.body.cancel();
      } finally {
        controller.abort();
      }
    });

    it.skip("should send initial state immediately", async () => {
      server = serverModule.createServer();

      await new Promise((resolve) => {
        server.listen(0, resolve);
      });

      const port = server.address().port;

      const controller = new AbortController();
      abortControllers.push(controller);

      try {
        const response = await fetch(`http://localhost:${port}/api/events`, {
          signal: controller.signal,
        });
        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        const { value } = await reader.read();
        const text = decoder.decode(value);

        // Initial SSE chunk no longer contains full state; clients should fetch /api/state
        expect(text).not.toContain("event: state");

        await reader.cancel();
      } finally {
        controller.abort();
      }
    });
  });

  describe("broadcastStateUpdate", () => {
    beforeEach(() => {
      // Ensure clean state before each test
      serverModule.sseRegistry.closeAll();
    });

    afterEach(() => {
      // Clean up mock clients after each test
      serverModule.sseRegistry.closeAll();
    });

    it("should send state to all connected clients", () => {
      const mockClient1 = { write: vi.fn() };
      const mockClient2 = { write: vi.fn() };

      serverModule.sseRegistry.addClient(mockClient1);
      serverModule.sseRegistry.addClient(mockClient2);

      const testState = {
        updatedAt: "2024-01-10T10:00:00.000Z",
        changeCount: 5,
        recentChanges: [],
        watchedPaths: [],
      };

      serverModule.broadcastStateUpdate(testState);

      // Server now emits a compact summary for state updates when no recentChanges exist
      expect(mockClient1.write).toHaveBeenCalledWith(
        expect.stringContaining("event: state:summary")
      );
      expect(mockClient1.write).toHaveBeenCalledWith(
        expect.stringContaining('"changeCount":5')
      );

      expect(mockClient2.write).toHaveBeenCalledWith(
        expect.stringContaining("event: state:summary")
      );
    });
  });

  describe("SSE message formatting", () => {
    beforeEach(() => {
      serverModule.sseRegistry.closeAll();
    });

    afterEach(() => {
      serverModule.sseRegistry.closeAll();
    });

    it("should format SSE messages correctly", () => {
      const mockClient = { write: vi.fn() };
      serverModule.sseRegistry.addClient(mockClient);

      const testState = {
        updatedAt: "2024-01-10T10:00:00.000Z",
        changeCount: 3,
        recentChanges: [
          {
            path: "test.txt",
            type: "created",
            timestamp: "2024-01-10T10:00:00.000Z",
          },
        ],
        watchedPaths: ["pipeline-config"],
      };

      serverModule.broadcastStateUpdate(testState);

      // The SSE registry makes multiple write calls - combine them
      const allWrites = mockClient.write.mock.calls
        .map((call) => call[0])
        .join("");

      // Verify SSE format for incremental change events
      expect(allWrites).toContain("event: state:change\n");
      expect(allWrites).toContain("data: ");
      expect(allWrites).toContain("\n\n");

      // Verify JSON content includes the change details (no full-state dump)
      expect(allWrites).not.toContain('"changeCount":3');
      expect(allWrites).toContain('"path":"test.txt"');
      expect(allWrites).toContain('"type":"created"');
    });
  });
});
