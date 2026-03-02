import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createSSEEnhancer } from "../sse-enhancer";

describe("sse-enhancer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("debounces and emits created then updated events", async () => {
    const readJobFn = vi.fn(async () => ({
      ok: true as const,
      jobId: "j1",
      location: "current",
      path: "/tmp/j1/tasks-status.json",
      data: {
        title: "Job 1",
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z",
        tasks: { task: { state: "running", files: {} } },
      },
    }));
    const broadcast = vi.fn();
    const enhancer = createSSEEnhancer({
      readJobFn,
      sseRegistry: { addClient() {}, removeClient() {}, broadcast, getClientCount() { return 0; }, closeAll() {} },
      debounceMs: 100,
    });

    enhancer.handleJobChange({ jobId: "j1" });
    expect(enhancer.getPendingCount()).toBe(1);
    vi.advanceTimersByTime(100);
    await Promise.resolve();
    expect(broadcast).toHaveBeenCalledWith("job:created", expect.any(Object));

    enhancer.handleJobChange({ jobId: "j1" });
    vi.advanceTimersByTime(100);
    await Promise.resolve();
    expect(broadcast).toHaveBeenCalledWith("job:updated", expect.any(Object));
  });

  it("cleans up pending timers", () => {
    const enhancer = createSSEEnhancer({
      readJobFn: vi.fn(async () => ({ ok: false as const, code: "x", message: "x", jobId: "j1", location: "" })),
      sseRegistry: { addClient() {}, removeClient() {}, broadcast() {}, getClientCount() { return 0; }, closeAll() {} },
      debounceMs: 100,
    });
    enhancer.handleJobChange({ jobId: "j1" });
    enhancer.cleanup();
    expect(enhancer.getPendingCount()).toBe(0);
  });
});
