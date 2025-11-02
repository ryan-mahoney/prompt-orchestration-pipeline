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

describe("Watcher", () => {
  let mockWatcher;
  let watcher;

  beforeEach(async () => {
    // Clear all mocks
    vi.clearAllMocks();
    vi.useFakeTimers();

    // Create mock watcher that extends EventEmitter
    mockWatcher = new EventEmitter();
    mockWatcher.close = vi.fn().mockResolvedValue(undefined);

    // Set up mock to return mockWatcher
    mockWatch.mockReturnValue(mockWatcher);

    // Import watcher module fresh
    vi.resetModules();
    watcher = await import("../src/ui/watcher.js");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("start", () => {
    it("should initialize chokidar with correct options", () => {
      const paths = ["pipeline-config", "runs"];
      const onChange = vi.fn();
      const baseDir = "/test/base";

      watcher.start(paths, onChange, { baseDir });

      expect(mockWatch).toHaveBeenCalledWith(paths, {
        ignored: /(^|[\/\\])(\.git|node_modules|dist)([\/\\]|$)/,
        persistent: true,
        ignoreInitial: true,
      });
    });

    it("should throw error when baseDir is not provided", () => {
      const paths = ["pipeline-config"];
      const onChange = vi.fn();

      expect(() => watcher.start(paths, onChange)).toThrow(
        "options.baseDir is required"
      );
    });

    it("should handle file creation events", () => {
      const onChange = vi.fn();
      const baseDir = "/test/base";
      const w = watcher.start(["test"], onChange, { baseDir });

      mockWatcher.emit("add", "/test/base/test/file.txt");

      // Should not fire immediately due to debounce
      expect(onChange).not.toHaveBeenCalled();

      // Advance timers to trigger debounce
      vi.advanceTimersByTime(200);

      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith([
        { path: "test/file.txt", type: "created" },
      ]);
    });

    it("should handle file modification events", () => {
      const onChange = vi.fn();
      const baseDir = "/test/base";
      const w = watcher.start(["test"], onChange, { baseDir });

      mockWatcher.emit("change", "/test/base/test/file.txt");
      vi.advanceTimersByTime(200);

      expect(onChange).toHaveBeenCalledWith([
        { path: "test/file.txt", type: "modified" },
      ]);
    });

    it("should handle file deletion events", () => {
      const onChange = vi.fn();
      const baseDir = "/test/base";
      const w = watcher.start(["test"], onChange, { baseDir });

      mockWatcher.emit("unlink", "/test/base/test/file.txt");
      vi.advanceTimersByTime(200);

      expect(onChange).toHaveBeenCalledWith([
        { path: "test/file.txt", type: "deleted" },
      ]);
    });

    it("should normalize pipeline-data paths and pass to detectJobChange", () => {
      const onChange = vi.fn();
      const baseDir = "/test/base";
      const w = watcher.start(["test"], onChange, { baseDir });

      // Mock the detectJobChange function
      const mockDetectJobChange = vi.fn();
      vi.doMock("../src/ui/job-change-detector.js", () => ({
        detectJobChange: mockDetectJobChange,
      }));

      const absolutePath =
        "/test/base/pipeline-data/current/abc123/tasks-status.json";
      mockWatcher.emit("change", absolutePath);
      vi.advanceTimersByTime(200);

      // Should receive normalized path
      expect(onChange).toHaveBeenCalledWith([
        {
          path: "pipeline-data/current/abc123/tasks-status.json",
          type: "modified",
        },
      ]);
    });

    it("should detect job changes and call sseEnhancer with normalized paths", () => {
      const onChange = vi.fn();
      const baseDir = "/test/demo";
      const mockSseEnhancer = { handleJobChange: vi.fn() };

      // Mock sseEnhancer module
      vi.doMock("../src/ui/sse-enhancer.js", () => mockSseEnhancer);

      const w = watcher.start(["some-path"], onChange, { baseDir });

      const absolutePath =
        "/test/demo/pipeline-data/current/job123/tasks-status.json";
      mockWatcher.emit("change", absolutePath);
      vi.advanceTimersByTime(200);

      // Should have called sseEnhancer with normalized job change
      expect(mockSseEnhancer.handleJobChange).toHaveBeenCalledWith({
        jobId: "job123",
        category: "status",
        filePath: "pipeline-data/current/job123/tasks-status.json",
      });

      // Should also call onChange with normalized path
      expect(onChange).toHaveBeenCalledWith([
        {
          path: "pipeline-data/current/job123/tasks-status.json",
          type: "modified",
        },
      ]);
    });

    it("should handle absolute paths for all lifecycles with sseEnhancer", () => {
      const onChange = vi.fn();
      const baseDir = "/workspace/project";
      const mockSseEnhancer = { handleJobChange: vi.fn() };

      vi.doMock("../src/ui/sse-enhancer.js", () => mockSseEnhancer);

      const w = watcher.start(["watch-path"], onChange, { baseDir });

      // Test complete lifecycle
      const completePath =
        "/workspace/project/pipeline-data/complete/job456/seed.json";
      mockWatcher.emit("change", completePath);
      vi.advanceTimersByTime(200);

      expect(mockSseEnhancer.handleJobChange).toHaveBeenCalledWith({
        jobId: "job456",
        category: "seed",
        filePath: "pipeline-data/complete/job456/seed.json",
      });

      // Test pending lifecycle
      const pendingPath =
        "/workspace/project/pipeline-data/pending/job789/tasks-status.json";
      mockWatcher.emit("change", pendingPath);
      vi.advanceTimersByTime(200);

      expect(mockSseEnhancer.handleJobChange).toHaveBeenCalledWith({
        jobId: "job789",
        category: "status",
        filePath: "pipeline-data/pending/job789/tasks-status.json",
      });

      // Test rejected lifecycle
      const rejectedPath =
        "/workspace/project/pipeline-data/rejected/job999/tasks/analysis/output.json";
      mockWatcher.emit("change", rejectedPath);
      vi.advanceTimersByTime(200);

      expect(mockSseEnhancer.handleJobChange).toHaveBeenCalledWith({
        jobId: "job999",
        category: "task",
        filePath: "pipeline-data/rejected/job999/tasks/analysis/output.json",
      });
    });

    it("should not call sseEnhancer for non-job file changes", () => {
      const onChange = vi.fn();
      const baseDir = "/test/base";
      const mockSseEnhancer = { handleJobChange: vi.fn() };

      vi.doMock("../src/ui/sse-enhancer.js", () => mockSseEnhancer);

      const w = watcher.start(["config"], onChange, { baseDir });

      const absolutePath = "/test/base/config/settings.json";
      mockWatcher.emit("change", absolutePath);
      vi.advanceTimersByTime(200);

      // Should not call sseEnhancer for non-job files
      expect(mockSseEnhancer.handleJobChange).not.toHaveBeenCalled();

      // Should still call onChange with relative path
      expect(onChange).toHaveBeenCalledWith([
        {
          path: "config/settings.json",
          type: "modified",
        },
      ]);
    });

    it("should handle Windows absolute paths and normalize correctly", () => {
      const onChange = vi.fn();
      const baseDir = "C:\\Users\\test\\project";
      const mockSseEnhancer = { handleJobChange: vi.fn() };

      vi.doMock("../src/ui/sse-enhancer.js", () => mockSseEnhancer);

      const w = watcher.start(["demo"], onChange, { baseDir });

      const windowsPath =
        "C:\\Users\\test\\project\\demo\\pipeline-data\\current\\job123\\tasks-status.json";
      mockWatcher.emit("change", windowsPath);
      vi.advanceTimersByTime(200);

      expect(mockSseEnhancer.handleJobChange).toHaveBeenCalledWith({
        jobId: "job123",
        category: "status",
        filePath: "pipeline-data/current/job123/tasks-status.json",
      });

      expect(onChange).toHaveBeenCalledWith([
        {
          path: "pipeline-data/current/job123/tasks-status.json",
          type: "modified",
        },
      ]);
    });

    it("should use relative path for non-pipeline-data paths", () => {
      const onChange = vi.fn();
      const baseDir = "/test/base";
      const w = watcher.start(["test"], onChange, { baseDir });

      const absolutePath = "/test/base/other-path/config.json";
      mockWatcher.emit("change", absolutePath);
      vi.advanceTimersByTime(200);

      // Should use relative path for consistency
      expect(onChange).toHaveBeenCalledWith([
        { path: "other-path/config.json", type: "modified" },
      ]);
    });

    it("should batch multiple rapid changes", () => {
      const onChange = vi.fn();
      const baseDir = "/test/base";
      const w = watcher.start(["test"], onChange, { baseDir });

      // Emit multiple events rapidly
      mockWatcher.emit("add", "/test/base/file1.txt");
      vi.advanceTimersByTime(50);
      mockWatcher.emit("change", "/test/base/file2.txt");
      vi.advanceTimersByTime(50);
      mockWatcher.emit("unlink", "/test/base/file3.txt");
      vi.advanceTimersByTime(50);

      // Should not have fired yet (at 150ms, but last event at 100ms needs 200ms)
      expect(onChange).not.toHaveBeenCalled();

      // Advance past debounce threshold from last event (need 150ms more to reach 300ms)
      vi.advanceTimersByTime(150);

      // Should batch all changes in one call
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith([
        { path: "file1.txt", type: "created" },
        { path: "file2.txt", type: "modified" },
        { path: "file3.txt", type: "deleted" },
      ]);
    });

    it("should reset debounce timer on new events", () => {
      const onChange = vi.fn();
      const baseDir = "/test/base";
      const w = watcher.start(["test"], onChange, { baseDir });

      mockWatcher.emit("add", "/test/base/file1.txt");
      vi.advanceTimersByTime(150); // Almost at 200ms

      mockWatcher.emit("change", "/test/base/file2.txt");
      vi.advanceTimersByTime(150); // Reset timer, now at 150ms from last event

      // Should not have fired yet
      expect(onChange).not.toHaveBeenCalled();

      vi.advanceTimersByTime(50); // Complete the 200ms from last event

      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith([
        { path: "file1.txt", type: "created" },
        { path: "file2.txt", type: "modified" },
      ]);
    });

    it("should support custom debounce time", () => {
      const onChange = vi.fn();
      const baseDir = "/test/base";
      const w = watcher.start(["test"], onChange, { baseDir, debounceMs: 500 });

      mockWatcher.emit("add", "/test/base/file.txt");

      vi.advanceTimersByTime(200);
      expect(onChange).not.toHaveBeenCalled();

      vi.advanceTimersByTime(300);
      expect(onChange).toHaveBeenCalledTimes(1);
    });

    it("should handle multiple separate change batches", () => {
      const onChange = vi.fn();
      const baseDir = "/test/base";
      const w = watcher.start(["test"], onChange, { baseDir });

      // First batch
      mockWatcher.emit("add", "/test/base/file1.txt");
      mockWatcher.emit("change", "/test/base/file2.txt");
      vi.advanceTimersByTime(200);

      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith([
        { path: "file1.txt", type: "created" },
        { path: "file2.txt", type: "modified" },
      ]);

      // Second batch
      mockWatcher.emit("unlink", "/test/base/file3.txt");
      mockWatcher.emit("add", "/test/base/file4.txt");
      vi.advanceTimersByTime(200);

      expect(onChange).toHaveBeenCalledTimes(2);
      expect(onChange).toHaveBeenLastCalledWith([
        { path: "file3.txt", type: "deleted" },
        { path: "file4.txt", type: "created" },
      ]);
    });

    it("should preserve event order within a batch", () => {
      const onChange = vi.fn();
      const baseDir = "/test/base";
      const w = watcher.start(["test"], onChange, { baseDir });

      mockWatcher.emit("add", "/test/base/first.txt");
      vi.advanceTimersByTime(10);
      mockWatcher.emit("change", "/test/base/second.txt");
      vi.advanceTimersByTime(10);
      mockWatcher.emit("unlink", "/test/base/third.txt");
      vi.advanceTimersByTime(10);
      mockWatcher.emit("add", "/test/base/fourth.txt");

      vi.advanceTimersByTime(200);

      const changes = onChange.mock.calls[0][0];
      expect(changes[0].path).toBe("first.txt");
      expect(changes[1].path).toBe("second.txt");
      expect(changes[2].path).toBe("third.txt");
      expect(changes[3].path).toBe("fourth.txt");
    });

    it("should not fire onChange with empty changes", () => {
      const onChange = vi.fn();
      const baseDir = "/test/base";
      const w = watcher.start(["test"], onChange, { baseDir });

      // Just advance time without any events
      vi.advanceTimersByTime(1000);

      expect(onChange).not.toHaveBeenCalled();
    });
  });

  describe("stop", () => {
    it("should close the watcher", async () => {
      const onChange = vi.fn();
      const baseDir = "/test/base";
      const w = watcher.start(["test"], onChange, { baseDir });

      await watcher.stop(w);

      expect(mockWatcher.close).toHaveBeenCalled();
    });

    it("should clear pending debounce timer", async () => {
      const onChange = vi.fn();
      const baseDir = "/test/base";
      const w = watcher.start(["test"], onChange, { baseDir });

      // Add a pending change
      mockWatcher.emit("add", "/test/base/file.txt");

      // Stop before debounce completes
      await watcher.stop(w);

      // Advance time - onChange should not fire
      vi.advanceTimersByTime(1000);
      expect(onChange).not.toHaveBeenCalled();
    });

    it("should handle null watcher gracefully", async () => {
      await expect(watcher.stop(null)).resolves.toBeUndefined();
    });

    it("should handle undefined watcher gracefully", async () => {
      await expect(watcher.stop(undefined)).resolves.toBeUndefined();
    });
  });

  describe("ignored paths", () => {
    it("should configure chokidar to ignore .git, node_modules, and dist", () => {
      const baseDir = "/test/base";
      watcher.start(["test"], vi.fn(), { baseDir });

      const ignoredPattern = mockWatch.mock.calls[0][1].ignored;

      // Test various path formats
      expect(ignoredPattern.test(".git")).toBe(true);
      expect(ignoredPattern.test("node_modules")).toBe(true);
      expect(ignoredPattern.test("dist")).toBe(true);
      expect(ignoredPattern.test("path/.git/config")).toBe(true);
      expect(ignoredPattern.test("path/node_modules/package")).toBe(true);
      expect(ignoredPattern.test("path/dist/bundle.js")).toBe(true);
      expect(ignoredPattern.test(".gitignore")).toBe(false);
      expect(ignoredPattern.test("src/dist.js")).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("should handle watcher with no events", async () => {
      const onChange = vi.fn();
      const baseDir = "/test/base";
      const w = watcher.start(["test"], onChange, { baseDir });

      vi.advanceTimersByTime(1000);
      expect(onChange).not.toHaveBeenCalled();

      await watcher.stop(w);
    });

    it("should handle empty paths array", () => {
      const onChange = vi.fn();
      const baseDir = "/test/base";
      const w = watcher.start([], onChange, { baseDir });

      expect(mockWatch).toHaveBeenCalledWith([], expect.any(Object));
    });

    it("should handle single path string converted to array internally by chokidar", () => {
      const onChange = vi.fn();
      const baseDir = "/test/base";
      const w = watcher.start(["single-path"], onChange, { baseDir });

      mockWatcher.emit("add", "/test/base/single-path/file.txt");
      vi.advanceTimersByTime(200);

      expect(onChange).toHaveBeenCalledWith([
        { path: "single-path/file.txt", type: "created" },
      ]);
    });

    it("should handle rapid start/stop cycles", async () => {
      const onChange = vi.fn();
      const baseDir = "/test/base";

      const w1 = watcher.start(["test"], onChange, { baseDir });
      await watcher.stop(w1);

      const w2 = watcher.start(["test"], onChange, { baseDir });
      await watcher.stop(w2);

      const w3 = watcher.start(["test"], onChange, { baseDir });
      await watcher.stop(w3);

      expect(mockWatcher.close).toHaveBeenCalledTimes(3);
    });
  });
});
