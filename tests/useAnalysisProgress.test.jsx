import { renderHook, act, waitFor } from "@testing-library/react";
import { vi, beforeEach, afterEach, describe, it, expect } from "vitest";
import { useAnalysisProgress } from "../src/ui/client/hooks/useAnalysisProgress.js";

// Helper to create a mock ReadableStream
function createMockStream(chunks) {
  let index = 0;
  return new ReadableStream({
    async pull(controller) {
      if (index < chunks.length) {
        const encoder = new TextEncoder();
        controller.enqueue(encoder.encode(chunks[index]));
        index++;
      } else {
        controller.close();
      }
    },
  });
}

// Helper to create SSE formatted message
function createSSEMessage(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

describe("useAnalysisProgress", () => {
  let mockFetch;

  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("initial state is idle with null values", () => {
    const { result } = renderHook(() => useAnalysisProgress());

    expect(result.current.status).toBe("idle");
    expect(result.current.pipelineSlug).toBe(null);
    expect(result.current.totalTasks).toBe(0);
    expect(result.current.completedTasks).toBe(0);
    expect(result.current.totalArtifacts).toBe(0);
    expect(result.current.completedArtifacts).toBe(0);
    expect(result.current.currentTask).toBe(null);
    expect(result.current.currentArtifact).toBe(null);
    expect(result.current.error).toBe(null);
  });

  it("startAnalysis sets status to connecting", async () => {
    const { result } = renderHook(() => useAnalysisProgress());

    const mockStream = createMockStream([
      createSSEMessage("started", {
        pipelineSlug: "test-pipeline",
        totalTasks: 5,
        totalArtifacts: 10,
      }),
    ]);

    mockFetch.mockResolvedValue({
      ok: true,
      body: mockStream,
    });

    act(() => {
      result.current.startAnalysis("test-pipeline");
    });

    expect(result.current.status).toBe("connecting");
    expect(result.current.pipelineSlug).toBe("test-pipeline");

    await waitFor(() => {
      expect(result.current.status).toBe("running");
    });
  });

  it("parses started event and updates state", async () => {
    const { result } = renderHook(() => useAnalysisProgress());

    const mockStream = createMockStream([
      createSSEMessage("started", {
        pipelineSlug: "my-pipeline",
        totalTasks: 3,
        totalArtifacts: 7,
      }),
    ]);

    mockFetch.mockResolvedValue({
      ok: true,
      body: mockStream,
    });

    await act(async () => {
      await result.current.startAnalysis("my-pipeline");
    });

    await waitFor(() => {
      expect(result.current.status).toBe("running");
      expect(result.current.pipelineSlug).toBe("my-pipeline");
      expect(result.current.totalTasks).toBe(3);
      expect(result.current.totalArtifacts).toBe(7);
    });
  });

  it("parses task:start and updates currentTask", async () => {
    const { result } = renderHook(() => useAnalysisProgress());

    const mockStream = createMockStream([
      createSSEMessage("started", {
        pipelineSlug: "test-pipeline",
        totalTasks: 2,
        totalArtifacts: 4,
      }),
      createSSEMessage("task:start", {
        taskId: "research",
        taskIndex: 0,
        totalTasks: 2,
      }),
    ]);

    mockFetch.mockResolvedValue({
      ok: true,
      body: mockStream,
    });

    await act(async () => {
      await result.current.startAnalysis("test-pipeline");
    });

    await waitFor(() => {
      expect(result.current.currentTask).toBe("research");
    });
  });

  it("parses artifact:complete and increments counter", async () => {
    const { result } = renderHook(() => useAnalysisProgress());

    const mockStream = createMockStream([
      createSSEMessage("started", {
        pipelineSlug: "test-pipeline",
        totalTasks: 1,
        totalArtifacts: 2,
      }),
      createSSEMessage("artifact:start", {
        taskId: "research",
        artifactName: "output.json",
        artifactIndex: 0,
        totalArtifacts: 2,
      }),
      createSSEMessage("artifact:complete", {
        taskId: "research",
        artifactName: "output.json",
        artifactIndex: 0,
        totalArtifacts: 2,
      }),
    ]);

    mockFetch.mockResolvedValue({
      ok: true,
      body: mockStream,
    });

    await act(async () => {
      await result.current.startAnalysis("test-pipeline");
    });

    await waitFor(() => {
      expect(result.current.completedArtifacts).toBe(1);
    });
  });

  it("parses complete and sets status", async () => {
    const { result } = renderHook(() => useAnalysisProgress());

    const mockStream = createMockStream([
      createSSEMessage("started", {
        pipelineSlug: "test-pipeline",
        totalTasks: 1,
        totalArtifacts: 1,
      }),
      createSSEMessage("complete", {
        pipelineSlug: "test-pipeline",
        tasksAnalyzed: 1,
        artifactsProcessed: 1,
        durationMs: 1000,
      }),
    ]);

    mockFetch.mockResolvedValue({
      ok: true,
      body: mockStream,
    });

    await act(async () => {
      await result.current.startAnalysis("test-pipeline");
    });

    await waitFor(() => {
      expect(result.current.status).toBe("complete");
      expect(result.current.currentTask).toBe(null);
      expect(result.current.currentArtifact).toBe(null);
    });
  });

  it("parses error and sets error state", async () => {
    const { result } = renderHook(() => useAnalysisProgress());

    const mockStream = createMockStream([
      createSSEMessage("started", {
        pipelineSlug: "test-pipeline",
        totalTasks: 1,
        totalArtifacts: 1,
      }),
      createSSEMessage("error", {
        message: "Failed to analyze task 'research': Parse error",
        taskId: "research",
      }),
    ]);

    mockFetch.mockResolvedValue({
      ok: true,
      body: mockStream,
    });

    await act(async () => {
      await result.current.startAnalysis("test-pipeline");
    });

    await waitFor(() => {
      expect(result.current.status).toBe("error");
      expect(result.current.error).toBe(
        "Failed to analyze task 'research': Parse error"
      );
    });
  });

  it("reset clears all state", async () => {
    const { result } = renderHook(() => useAnalysisProgress());

    const mockStream = createMockStream([
      createSSEMessage("started", {
        pipelineSlug: "test-pipeline",
        totalTasks: 1,
        totalArtifacts: 1,
      }),
      createSSEMessage("task:start", {
        taskId: "research",
        taskIndex: 0,
        totalTasks: 1,
      }),
    ]);

    mockFetch.mockResolvedValue({
      ok: true,
      body: mockStream,
    });

    await act(async () => {
      await result.current.startAnalysis("test-pipeline");
    });

    await waitFor(() => {
      expect(result.current.status).toBe("running");
    });

    act(() => {
      result.current.reset();
    });

    expect(result.current.status).toBe("idle");
    expect(result.current.pipelineSlug).toBe(null);
    expect(result.current.totalTasks).toBe(0);
    expect(result.current.completedTasks).toBe(0);
    expect(result.current.totalArtifacts).toBe(0);
    expect(result.current.completedArtifacts).toBe(0);
    expect(result.current.currentTask).toBe(null);
    expect(result.current.currentArtifact).toBe(null);
    expect(result.current.error).toBe(null);
  });

  it("handles artifact:start event", async () => {
    const { result } = renderHook(() => useAnalysisProgress());

    const mockStream = createMockStream([
      createSSEMessage("started", {
        pipelineSlug: "test-pipeline",
        totalTasks: 1,
        totalArtifacts: 1,
      }),
      createSSEMessage("artifact:start", {
        taskId: "research",
        artifactName: "output.json",
        artifactIndex: 0,
        totalArtifacts: 1,
      }),
    ]);

    mockFetch.mockResolvedValue({
      ok: true,
      body: mockStream,
    });

    await act(async () => {
      await result.current.startAnalysis("test-pipeline");
    });

    await waitFor(() => {
      expect(result.current.currentArtifact).toBe("output.json");
    });
  });

  it("handles task:complete event", async () => {
    const { result } = renderHook(() => useAnalysisProgress());

    const mockStream = createMockStream([
      createSSEMessage("started", {
        pipelineSlug: "test-pipeline",
        totalTasks: 1,
        totalArtifacts: 0,
      }),
      createSSEMessage("task:start", {
        taskId: "research",
        taskIndex: 0,
        totalTasks: 1,
      }),
      createSSEMessage("task:complete", {
        taskId: "research",
        taskIndex: 0,
        totalTasks: 1,
      }),
    ]);

    mockFetch.mockResolvedValue({
      ok: true,
      body: mockStream,
    });

    await act(async () => {
      await result.current.startAnalysis("test-pipeline");
    });

    await waitFor(() => {
      expect(result.current.completedTasks).toBe(1);
      expect(result.current.currentArtifact).toBe(null);
    });
  });

  it("handles HTTP error responses", async () => {
    const { result } = renderHook(() => useAnalysisProgress());

    mockFetch.mockResolvedValue({
      ok: false,
      status: 409,
      statusText: "Conflict",
      body: new ReadableStream({
        start(controller) {
          controller.close();
        },
      }),
      json: async () => ({
        ok: false,
        code: "analysis_locked",
        message: "Analysis already in progress",
      }),
    });

    await act(async () => {
      await result.current.startAnalysis("test-pipeline");
    });

    await waitFor(() => {
      expect(result.current.status).toBe("error");
      expect(result.current.error).toBe("Analysis already in progress");
    });
  });

  it("handles fetch abort", async () => {
    const { result } = renderHook(() => useAnalysisProgress());

    // Create a stream that never resolves
    const mockStream = new ReadableStream({
      start() {
        // Never pull, simulating a hanging connection
      },
    });

    mockFetch.mockResolvedValue({
      ok: true,
      body: mockStream,
    });

    await act(async () => {
      result.current.startAnalysis("test-pipeline");
    });

    await waitFor(() => {
      expect(result.current.status).toBe("connecting");
    });

    act(() => {
      result.current.reset();
    });

    expect(result.current.status).toBe("idle");
  });

  it("processes multiple events in sequence", async () => {
    const { result } = renderHook(() => useAnalysisProgress());

    const mockStream = createMockStream([
      createSSEMessage("started", {
        pipelineSlug: "test-pipeline",
        totalTasks: 2,
        totalArtifacts: 3,
      }),
      createSSEMessage("task:start", { taskId: "task1" }),
      createSSEMessage("artifact:start", { artifactName: "output1.json" }),
      createSSEMessage("artifact:complete", { artifactName: "output1.json" }),
      createSSEMessage("task:complete", { taskId: "task1" }),
      createSSEMessage("task:start", { taskId: "task2" }),
      createSSEMessage("artifact:start", { artifactName: "output2.json" }),
      createSSEMessage("artifact:complete", { artifactName: "output2.json" }),
      createSSEMessage("task:complete", { taskId: "task2" }),
      createSSEMessage("complete", {
        pipelineSlug: "test-pipeline",
        tasksAnalyzed: 2,
        artifactsProcessed: 3,
      }),
    ]);

    mockFetch.mockResolvedValue({
      ok: true,
      body: mockStream,
    });

    await act(async () => {
      await result.current.startAnalysis("test-pipeline");
    });

    await waitFor(() => {
      expect(result.current.status).toBe("complete");
      expect(result.current.completedTasks).toBe(2);
      expect(result.current.completedArtifacts).toBe(2);
    });
  });
});
