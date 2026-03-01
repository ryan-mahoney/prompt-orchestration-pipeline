// Global test setup file for Vitest
import { vi, beforeEach, afterEach, afterAll, expect } from "vitest";
import {
  cleanupAllServers,
  getActiveServerCount,
} from "./utils/serverHelper.js";

// Add testing library matchers (Vitest-specific import)
import "@testing-library/jest-dom/vitest";

// Set NODE_ENV to 'test' for all tests
process.env.NODE_ENV = "test";

// Polyfill EventSource for test environment (jsdom doesn't have it)
if (!global.EventSource) {
  class EventSource {
    constructor(url) {
      this.url = url;
      this.listeners = {};
      this.readyState = 0; // CONNECTING

      // Mock implementation for testing
      setTimeout(() => {
        this.readyState = 1; // OPEN
        if (this.onopen) this.onopen();
      }, 10);
    }

    addEventListener(event, callback) {
      if (!this.listeners[event]) {
        this.listeners[event] = [];
      }
      this.listeners[event].push(callback);
    }

    removeEventListener(event, callback) {
      if (this.listeners[event]) {
        this.listeners[event] = this.listeners[event].filter(
          (cb) => cb !== callback
        );
      }
    }

    close() {
      this.readyState = 2; // CLOSED
      if (this.onclose) this.onclose();
    }

    // Mock method to simulate receiving events in tests
    _mockReceiveEvent(event) {
      if (this.listeners[event.type]) {
        this.listeners[event.type].forEach((callback) => callback(event));
      }
      if (this.onmessage) {
        this.onmessage(event);
      }
    }
  }

  global.EventSource = EventSource;
}

// Global test utilities and setup
global.testUtils = {
  // Helper to create mock context for pipeline tests
  createMockContext: (overrides = {}) => ({
    id: "test-pipeline-123",
    taskId: "test-task-456",
    timestamp: new Date().toISOString(),
    ...overrides,
  }),

  // Helper to create mock task functions
  createMockTask: (name, implementation) => {
    const mockFn = vi.fn(implementation);
    mockFn.taskName = name;
    return mockFn;
  },

  // Helper to reset all mocks between tests
  resetAllMocks: () => {
    vi.clearAllMocks();
    vi.resetAllMocks();
    vi.restoreAllMocks();
  },
};

// Global beforeEach hook
beforeEach(() => {
  // Reset all mocks before each test
  global.testUtils.resetAllMocks();
  console.log("[tests/setup] beforeEach forcing real timers");
  // React Testing Library suites expect real timers so waitFor polling and cleanup work.
  // Individual tests should opt into fake timers explicitly when required.
  vi.useRealTimers();
});

// Global afterEach hook
afterEach(() => {
  console.log("[tests/setup] afterEach ensuring real timers");
  // Restore real timers
  vi.useRealTimers();

  // Clean up any global state
  if (global.__mockTasks) {
    delete global.__mockTasks;
  }
});

// Global test timeout configuration
// (overridden by individual test timeouts if needed)

// Global cleanup guard - catch any leaked servers after all tests
afterAll(async () => {
  const activeCount = getActiveServerCount();
  if (activeCount > 0) {
    console.warn(
      `⚠️  WARNING: ${activeCount} server(s) still active after all tests completed`
    );
    console.warn("This indicates a test cleanup issue - forcing cleanup now");
    await cleanupAllServers();
  }
});
