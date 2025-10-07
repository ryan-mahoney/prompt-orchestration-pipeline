import { vi } from "vitest";

/**
 * Environment setup and polyfills for E2E testing
 * Ensures fetch, FormData, Blob, File, and EventSource exist in the test environment
 */

// Check if we're in Node.js environment (not browser)
const isNode = typeof window === "undefined";

// Polyfill File class if not available (Node.js environment)
if (isNode && !global.File) {
  class File extends Blob {
    constructor(fileBits, fileName, options = {}) {
      super(fileBits, options);
      this.name = fileName;
      this.lastModified = options.lastModified || Date.now();
    }
  }
  global.File = File;
}

// Polyfill EventSource for Node.js environment
// Always set it to ensure consistent test environment
if (isNode) {
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

  // Always set global.EventSource in Node.js environment for tests
  global.EventSource = EventSource;
}

// Export the polyfilled globals for use in tests
export { File, EventSource };

/**
 * Configure fake timers for tests that use them
 * This should be called in test setup
 */
export function configureFakeTimers() {
  vi.useFakeTimers();
}

/**
 * Restore real timers after tests
 */
export function restoreRealTimers() {
  vi.useRealTimers();
}

/**
 * Setup test environment with all required polyfills
 */
export function setupTestEnvironment(options = {}) {
  const { useFakeTimers = false } = options;

  if (useFakeTimers) {
    configureFakeTimers();
  } else {
    // Default to real timers for E2E-style tests to avoid hanging async waits
    restoreRealTimers();
  }

  // Ensure fetch is available (Node 18+ has fetch built-in)
  if (isNode && !global.fetch) {
    // If fetch is not available, we'd need to polyfill it
    // For now, we assume Node 18+ which has fetch built-in
    console.warn("fetch not available - ensure Node 18+ for E2E tests");
  }

  // Ensure FormData is available (Node 18+ has FormData built-in)
  if (isNode && !global.FormData) {
    console.warn("FormData not available - ensure Node 18+ for E2E tests");
  }

  // Ensure Blob is available (Node 18+ has Blob built-in)
  if (isNode && !global.Blob) {
    console.warn("Blob not available - ensure Node 18+ for E2E tests");
  }
}
