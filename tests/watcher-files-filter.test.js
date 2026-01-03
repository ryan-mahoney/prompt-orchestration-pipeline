import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventEmitter } from "events";

// Hoist the mock watch function
const { mockWatch } = vi.hoisted(() => ({
  mockWatch: vi.fn(),
}));

// Mock chokidar
vi.mock("chokidar", () => ({
  default: {
    watch: mockWatch,
  },
}));

describe("Watcher - files/ modification filtering", () => {
  let mockWatcher;
  let watcher;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    mockWatcher = new EventEmitter();
    mockWatcher.close = vi.fn().mockResolvedValue(undefined);
    mockWatch.mockReturnValue(mockWatcher);

    vi.resetModules();
    watcher = await import("../src/ui/watcher.js");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should skip modification events for files under pipeline-data/.../files/", () => {
    const onChange = vi.fn();
    const baseDir = "/test/base";
    watcher.start(["pipeline-data"], onChange, { baseDir });

    // Emit modification event for log file
    mockWatcher.emit(
      "change",
      "/test/base/pipeline-data/current/job123/files/logs/task.log"
    );
    vi.advanceTimersByTime(200);

    // Should NOT call onChange
    expect(onChange).not.toHaveBeenCalled();
  });

  it("should allow creation events for files under pipeline-data/.../files/", () => {
    const onChange = vi.fn();
    const baseDir = "/test/base";
    watcher.start(["pipeline-data"], onChange, { baseDir });

    // Emit creation event for log file
    mockWatcher.emit(
      "add",
      "/test/base/pipeline-data/current/job123/files/logs/task.log"
    );
    vi.advanceTimersByTime(200);

    // SHOULD call onChange for creation
    expect(onChange).toHaveBeenCalledWith([
      {
        path: "pipeline-data/current/job123/files/logs/task.log",
        type: "created",
      },
    ]);
  });

  it("should allow deletion events for files under pipeline-data/.../files/", () => {
    const onChange = vi.fn();
    const baseDir = "/test/base";
    watcher.start(["pipeline-data"], onChange, { baseDir });

    // Emit deletion event for log file
    mockWatcher.emit(
      "unlink",
      "/test/base/pipeline-data/current/job123/files/logs/task.log"
    );
    vi.advanceTimersByTime(200);

    // SHOULD call onChange for deletion
    expect(onChange).toHaveBeenCalledWith([
      {
        path: "pipeline-data/current/job123/files/logs/task.log",
        type: "deleted",
      },
    ]);
  });

  it("should still allow modification events for non-files/ paths", () => {
    const onChange = vi.fn();
    const baseDir = "/test/base";
    watcher.start(["pipeline-data"], onChange, { baseDir });

    // Emit modification event for tasks-status.json
    mockWatcher.emit(
      "change",
      "/test/base/pipeline-data/current/job123/tasks-status.json"
    );
    vi.advanceTimersByTime(200);

    // SHOULD call onChange for non-files/ modification
    expect(onChange).toHaveBeenCalledWith([
      {
        path: "pipeline-data/current/job123/tasks-status.json",
        type: "modified",
      },
    ]);
  });

  it("should filter files/ modifications across all lifecycle statuses", () => {
    const onChange = vi.fn();
    const baseDir = "/test/base";
    watcher.start(["pipeline-data"], onChange, { baseDir });

    // Test all lifecycle statuses
    mockWatcher.emit(
      "change",
      "/test/base/pipeline-data/complete/job1/files/output.json"
    );
    mockWatcher.emit(
      "change",
      "/test/base/pipeline-data/pending/job2/files/logs/debug.log"
    );
    mockWatcher.emit(
      "change",
      "/test/base/pipeline-data/rejected/job3/files/error.txt"
    );
    vi.advanceTimersByTime(200);

    // None should trigger onChange
    expect(onChange).not.toHaveBeenCalled();
  });
});
