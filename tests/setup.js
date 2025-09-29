// Global test setup file for Vitest
import { vi, beforeEach, afterEach } from "vitest";

// Global test utilities and setup
global.testUtils = {
  // Helper to create mock context for pipeline tests
  createMockContext: (overrides = {}) => ({
    pipelineId: "test-pipeline-123",
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

  // Set up fake timers if needed
  vi.useFakeTimers();
});

// Global afterEach hook
afterEach(() => {
  // Restore real timers
  vi.useRealTimers();

  // Clean up any global state
  if (global.__mockTasks) {
    delete global.__mockTasks;
  }
});

// Global test timeout configuration
// (overridden by individual test timeouts if needed)
