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

      watcher.start(paths, onChange);

      expect(mockWatch).toHaveBeenCalledWith(paths, {
        ignored: /(^|[\/\\])(\.git|node_modules|dist)([\/\\]|$)/,
        persistent: true,
        ignoreInitial: true,
      });
    });

    it("should handle file creation events", () => {
      const onChange = vi.fn();
      const w = watcher.start(["test"], onChange);

      mockWatcher.emit("add", "test/file.txt");

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
      const w = watcher.start(["test"], onChange);

      mockWatcher.emit("change", "test/file.txt");
      vi.advanceTimersByTime(200);

      expect(onChange).toHaveBeenCalledWith([
        { path: "test/file.txt", type: "modified" },
      ]);
    });

    it("should handle file deletion events", () => {
      const onChange = vi.fn();
      const w = watcher.start(["test"], onChange);

      mockWatcher.emit("unlink", "test/file.txt");
      vi.advanceTimersByTime(200);

      expect(onChange).toHaveBeenCalledWith([
        { path: "test/file.txt", type: "deleted" },
      ]);
    });

    it("should batch multiple rapid changes", () => {
      const onChange = vi.fn();
      const w = watcher.start(["test"], onChange);

      // Emit multiple events rapidly
      mockWatcher.emit("add", "file1.txt");
      vi.advanceTimersByTime(50);
      mockWatcher.emit("change", "file2.txt");
      vi.advanceTimersByTime(50);
      mockWatcher.emit("unlink", "file3.txt");
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
      const w = watcher.start(["test"], onChange);

      mockWatcher.emit("add", "file1.txt");
      vi.advanceTimersByTime(150); // Almost at 200ms

      mockWatcher.emit("change", "file2.txt");
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
      const w = watcher.start(["test"], onChange, { debounceMs: 500 });

      mockWatcher.emit("add", "file.txt");

      vi.advanceTimersByTime(200);
      expect(onChange).not.toHaveBeenCalled();

      vi.advanceTimersByTime(300);
      expect(onChange).toHaveBeenCalledTimes(1);
    });

    it("should handle multiple separate change batches", () => {
      const onChange = vi.fn();
      const w = watcher.start(["test"], onChange);

      // First batch
      mockWatcher.emit("add", "file1.txt");
      mockWatcher.emit("change", "file2.txt");
      vi.advanceTimersByTime(200);

      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith([
        { path: "file1.txt", type: "created" },
        { path: "file2.txt", type: "modified" },
      ]);

      // Second batch
      mockWatcher.emit("unlink", "file3.txt");
      mockWatcher.emit("add", "file4.txt");
      vi.advanceTimersByTime(200);

      expect(onChange).toHaveBeenCalledTimes(2);
      expect(onChange).toHaveBeenLastCalledWith([
        { path: "file3.txt", type: "deleted" },
        { path: "file4.txt", type: "created" },
      ]);
    });

    it("should preserve event order within a batch", () => {
      const onChange = vi.fn();
      const w = watcher.start(["test"], onChange);

      mockWatcher.emit("add", "first.txt");
      vi.advanceTimersByTime(10);
      mockWatcher.emit("change", "second.txt");
      vi.advanceTimersByTime(10);
      mockWatcher.emit("unlink", "third.txt");
      vi.advanceTimersByTime(10);
      mockWatcher.emit("add", "fourth.txt");

      vi.advanceTimersByTime(200);

      const changes = onChange.mock.calls[0][0];
      expect(changes[0].path).toBe("first.txt");
      expect(changes[1].path).toBe("second.txt");
      expect(changes[2].path).toBe("third.txt");
      expect(changes[3].path).toBe("fourth.txt");
    });

    it("should not fire onChange with empty changes", () => {
      const onChange = vi.fn();
      const w = watcher.start(["test"], onChange);

      // Just advance time without any events
      vi.advanceTimersByTime(1000);

      expect(onChange).not.toHaveBeenCalled();
    });
  });

  describe("stop", () => {
    it("should close the watcher", async () => {
      const onChange = vi.fn();
      const w = watcher.start(["test"], onChange);

      await watcher.stop(w);

      expect(mockWatcher.close).toHaveBeenCalled();
    });

    it("should clear pending debounce timer", async () => {
      const onChange = vi.fn();
      const w = watcher.start(["test"], onChange);

      // Add a pending change
      mockWatcher.emit("add", "file.txt");

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
      watcher.start(["test"], vi.fn());

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
      const w = watcher.start(["test"], onChange);

      vi.advanceTimersByTime(1000);
      expect(onChange).not.toHaveBeenCalled();

      await watcher.stop(w);
    });

    it("should handle empty paths array", () => {
      const onChange = vi.fn();
      const w = watcher.start([], onChange);

      expect(mockWatch).toHaveBeenCalledWith([], expect.any(Object));
    });

    it("should handle single path string converted to array internally by chokidar", () => {
      const onChange = vi.fn();
      const w = watcher.start(["single-path"], onChange);

      mockWatcher.emit("add", "single-path/file.txt");
      vi.advanceTimersByTime(200);

      expect(onChange).toHaveBeenCalledWith([
        { path: "single-path/file.txt", type: "created" },
      ]);
    });

    it("should handle rapid start/stop cycles", async () => {
      const onChange = vi.fn();

      const w1 = watcher.start(["test"], onChange);
      await watcher.stop(w1);

      const w2 = watcher.start(["test"], onChange);
      await watcher.stop(w2);

      const w3 = watcher.start(["test"], onChange);
      await watcher.stop(w3);

      expect(mockWatcher.close).toHaveBeenCalledTimes(3);
    });
  });
});
