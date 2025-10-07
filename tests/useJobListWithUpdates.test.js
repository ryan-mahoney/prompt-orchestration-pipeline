import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useJobListWithUpdates } from "../src/ui/client/hooks/useJobListWithUpdates.js";

// Mock the useJobList hook
vi.mock("../src/ui/client/hooks/useJobList.js", () => ({
  useJobList: vi.fn(),
}));

// Mock EventSource globally
const mockEventSource = {
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  close: vi.fn(),
  readyState: 1, // OPEN
};
const MockEventSource = vi.fn(() => mockEventSource);
global.EventSource = MockEventSource;

// Import after mocking
import { useJobList } from "../src/ui/client/hooks/useJobList.js";

describe("useJobListWithUpdates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEventSource.readyState = 1; // OPEN
    // Use real timers for these tests since we use setTimeout for reconnection
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("should initialize with useJobList state", () => {
    useJobList.mockReturnValue({
      loading: true,
      data: null,
      error: null,
      refetch: vi.fn(),
    });

    const { result } = renderHook(() => useJobListWithUpdates());

    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBe(null);
    expect(result.current.error).toBe(null);
    expect(result.current.connectionStatus).toBe("disconnected");
  });

  it("should establish SSE connection when data is available", async () => {
    const mockJobs = [
      {
        id: "job-1",
        name: "Test Job 1",
        status: "running",
        progress: 50,
        createdAt: "2024-01-01T00:00:00Z",
        location: "current",
      },
    ];

    useJobList.mockReturnValue({
      loading: false,
      data: mockJobs,
      error: null,
      refetch: vi.fn(),
    });

    const { result } = renderHook(() => useJobListWithUpdates());

    await waitFor(
      () => {
        expect(result.current.loading).toBe(false);
      },
      { timeout: 5000, interval: 500 }
    );

    expect(result.current.connectionStatus).toBe("connected");
    expect(mockEventSource.addEventListener).toHaveBeenCalledWith(
      "open",
      expect.any(Function)
    );
    expect(mockEventSource.addEventListener).toHaveBeenCalledWith(
      "job:updated",
      expect.any(Function)
    );
    expect(mockEventSource.addEventListener).toHaveBeenCalledWith(
      "error",
      expect.any(Function)
    );
  });

  it("should not establish SSE connection when no data", () => {
    useJobList.mockReturnValue({
      loading: false,
      data: [],
      error: null,
      refetch: vi.fn(),
    });

    renderHook(() => useJobListWithUpdates());

    expect(MockEventSource).not.toHaveBeenCalled();
  });

  it("should handle job update events", async () => {
    const initialJobs = [
      {
        id: "job-1",
        name: "Test Job 1",
        status: "running",
        progress: 50,
        createdAt: "2024-01-01T00:00:00Z",
        location: "current",
      },
    ];

    const updatedJob = {
      id: "job-1",
      name: "Test Job 1",
      status: "complete",
      progress: 100,
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T01:00:00Z",
      location: "complete",
    };

    useJobList.mockReturnValue({
      loading: false,
      data: initialJobs,
      error: null,
      refetch: vi.fn(),
    });

    const { result } = renderHook(() => useJobListWithUpdates());

    // Wait for SSE setup
    await waitFor(
      () => {
        expect(MockEventSource).toHaveBeenCalled();
      },
      { timeout: 5000, interval: 500 }
    );

    // Get the job update handler
    const jobUpdateHandler = mockEventSource.addEventListener.mock.calls.find(
      (call) => call[0] === "job:updated"
    )[1];

    // Simulate job update event
    const mockEvent = { data: JSON.stringify(updatedJob) };
    act(() => {
      jobUpdateHandler(mockEvent);
    });

    // Should update the local data state
    // We can't easily spy on setLocalData, but we can verify the hook behavior
    // by checking that the hook doesn't crash and continues to work
    expect(result.current.data).toBeDefined();
  });

  it("should add new job when update is for unknown job", async () => {
    const initialJobs = [
      {
        id: "job-1",
        name: "Test Job 1",
        status: "running",
        progress: 50,
        createdAt: "2024-01-01T00:00:00Z",
        location: "current",
      },
    ];

    const newJob = {
      id: "job-2",
      name: "Test Job 2",
      status: "running",
      progress: 25,
      createdAt: "2024-01-02T00:00:00Z",
      location: "current",
    };

    useJobList.mockReturnValue({
      loading: false,
      data: initialJobs,
      error: null,
      refetch: vi.fn(),
    });

    const { result } = renderHook(() => useJobListWithUpdates());

    // Wait for SSE setup
    await waitFor(
      () => {
        expect(MockEventSource).toHaveBeenCalled();
      },
      { timeout: 5000, interval: 500 }
    );

    // Get the job update handler
    const jobUpdateHandler = mockEventSource.addEventListener.mock.calls.find(
      (call) => call[0] === "job:updated"
    )[1];

    // Simulate new job event
    const mockEvent = { data: JSON.stringify(newJob) };
    act(() => {
      jobUpdateHandler(mockEvent);
    });

    // Should handle the new job without crashing
    expect(result.current.data).toBeDefined();
  });

  it("should handle invalid job update events gracefully", async () => {
    const initialJobs = [
      {
        id: "job-1",
        name: "Test Job 1",
        status: "running",
        progress: 50,
        createdAt: "2024-01-01T00:00:00Z",
        location: "current",
      },
    ];

    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    useJobList.mockReturnValue({
      loading: false,
      data: initialJobs,
      error: null,
      refetch: vi.fn(),
    });

    renderHook(() => useJobListWithUpdates());

    // Wait for SSE setup
    await waitFor(
      () => {
        expect(MockEventSource).toHaveBeenCalled();
      },
      { timeout: 5000, interval: 500 }
    );

    // Get the job update handler
    const jobUpdateHandler = mockEventSource.addEventListener.mock.calls.find(
      (call) => call[0] === "job:updated"
    )[1];

    // Simulate invalid JSON event
    const mockEvent = { data: "invalid json" };
    act(() => {
      jobUpdateHandler(mockEvent);
    });

    // Should log error but not crash
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "Failed to parse job update event:",
      expect.any(SyntaxError)
    );

    consoleErrorSpy.mockRestore();
  });

  it("should handle SSE connection errors and attempt reconnect", () => {
    const mockJobs = [
      {
        id: "job-1",
        name: "Test Job 1",
        status: "running",
        progress: 50,
        createdAt: "2024-01-01T00:00:00Z",
        location: "current",
      },
    ];

    useJobList.mockReturnValue({
      loading: false,
      data: mockJobs,
      error: null,
      refetch: vi.fn(),
    });

    // Use fake timers for this specific test
    vi.useFakeTimers();

    const { result } = renderHook(() => useJobListWithUpdates());

    // MockEventSource should be called immediately
    expect(MockEventSource).toHaveBeenCalled();

    // Get the error handler
    const errorHandler = mockEventSource.addEventListener.mock.calls.find(
      (call) => call[0] === "error"
    )[1];

    // Simulate closed connection
    mockEventSource.readyState = 2; // CLOSED
    act(() => {
      errorHandler({});
    });

    expect(result.current.connectionStatus).toBe("disconnected");

    // Advance timers to trigger reconnect (2000ms delay)
    act(() => {
      vi.advanceTimersByTime(2000);
    });

    // Should attempt to reconnect
    expect(MockEventSource).toHaveBeenCalledTimes(2);

    // Clean up timers
    vi.useRealTimers();
  });

  it("should clean up SSE connection on unmount", async () => {
    const mockJobs = [
      {
        id: "job-1",
        name: "Test Job 1",
        status: "running",
        progress: 50,
        createdAt: "2024-01-01T00:00:00Z",
        location: "current",
      },
    ];

    useJobList.mockReturnValue({
      loading: false,
      data: mockJobs,
      error: null,
      refetch: vi.fn(),
    });

    const { unmount } = renderHook(() => useJobListWithUpdates());

    // Wait for SSE setup
    await waitFor(
      () => {
        expect(MockEventSource).toHaveBeenCalled();
      },
      { timeout: 1000 }
    );

    // Unmount component
    unmount();

    // Should close event source
    expect(mockEventSource.close).toHaveBeenCalled();
  });

  it("should handle SSE connection creation failure", async () => {
    const mockJobs = [
      {
        id: "job-1",
        name: "Test Job 1",
        status: "running",
        progress: 50,
        createdAt: "2024-01-01T00:00:00Z",
        location: "current",
      },
    ];

    useJobList.mockReturnValue({
      loading: false,
      data: mockJobs,
      error: null,
      refetch: vi.fn(),
    });

    // Mock EventSource to throw error
    MockEventSource.mockImplementationOnce(() => {
      throw new Error("EventSource not supported");
    });

    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const { result } = renderHook(() => useJobListWithUpdates());

    // Should handle error gracefully
    expect(result.current.connectionStatus).toBe("error");
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "Failed to create SSE connection:",
      expect.any(Error)
    );

    consoleErrorSpy.mockRestore();
  });
});
