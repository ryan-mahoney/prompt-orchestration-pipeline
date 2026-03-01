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

      const callArgs = mockWatch.mock.calls[0][1];
      expect(mockWatch).toHaveBeenCalledWith(paths, expect.any(Object));
      expect(callArgs.ignored).toBeInstanceOf(Array);
      expect(callArgs.ignored).toHaveLength(2);
      expect(callArgs.followSymlinks).toBe(false);
      expect(callArgs.persistent).toBe(true);
      expect(callArgs.ignoreInitial).toBe(true);
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

      const ignoredPatterns = mockWatch.mock.calls[0][1].ignored;

      // Should be an array of patterns
      expect(ignoredPatterns).toBeInstanceOf(Array);
      expect(ignoredPatterns).toHaveLength(2);

      // Test the first pattern (common ignore patterns)
      const commonPattern = ignoredPatterns[0];
      expect(commonPattern.test(".git")).toBe(true);
      expect(commonPattern.test("node_modules")).toBe(true);
      expect(commonPattern.test("dist")).toBe(true);
      expect(commonPattern.test("path/.git/config")).toBe(true);
      expect(commonPattern.test("path/node_modules/package")).toBe(true);
      expect(commonPattern.test("path/dist/bundle.js")).toBe(true);
      expect(commonPattern.test(".gitignore")).toBe(false);
      expect(commonPattern.test("src/dist.js")).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("should handle empty paths array", () => {
      const onChange = vi.fn();
      const baseDir = "/test/base";
      const w = watcher.start([], onChange, { baseDir });

      expect(mockWatch).toHaveBeenCalledWith([], expect.any(Object));
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
