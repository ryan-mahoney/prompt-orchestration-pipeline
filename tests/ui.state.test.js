import { describe, it, expect, beforeEach, vi } from "vitest";
import * as state from "../src/ui/state.js";

describe("State Manager", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-10T10:00:00Z"));
    state.reset();
  });

  describe("getState", () => {
    it("should return initial state", () => {
      const currentState = state.getState();

      expect(currentState).toEqual({
        updatedAt: "2024-01-10T10:00:00.000Z",
        changeCount: 0,
        recentChanges: [],
        watchedPaths: [],
      });
    });

    it("should return a copy of state, not a reference", () => {
      const state1 = state.getState();
      const state2 = state.getState();

      expect(state1).not.toBe(state2);
      expect(state1).toEqual(state2);
    });
  });

  describe("recordChange", () => {
    it("should record a file creation", () => {
      const result = state.recordChange("pipeline-config/test.yaml", "created");

      expect(result.changeCount).toBe(1);
      expect(result.updatedAt).toBe("2024-01-10T10:00:00.000Z");
      expect(result.recentChanges).toHaveLength(1);
      expect(result.recentChanges[0]).toEqual({
        path: "pipeline-config/test.yaml",
        type: "created",
        timestamp: "2024-01-10T10:00:00.000Z",
      });
    });

    it("should record multiple changes", () => {
      vi.setSystemTime(new Date("2024-01-10T10:00:00Z"));
      state.recordChange("file1.txt", "created");

      vi.setSystemTime(new Date("2024-01-10T10:00:01Z"));
      state.recordChange("file2.txt", "modified");

      vi.setSystemTime(new Date("2024-01-10T10:00:02Z"));
      const result = state.recordChange("file3.txt", "deleted");

      expect(result.changeCount).toBe(3);
      expect(result.recentChanges).toHaveLength(3);
      expect(result.recentChanges[0].path).toBe("file3.txt");
      expect(result.recentChanges[1].path).toBe("file2.txt");
      expect(result.recentChanges[2].path).toBe("file1.txt");
    });

    it("should maintain FIFO order for recent changes", () => {
      for (let i = 1; i <= 12; i++) {
        vi.setSystemTime(
          new Date(`2024-01-10T10:00:${i.toString().padStart(2, "0")}Z`)
        );
        state.recordChange(`file${i}.txt`, "modified");
      }

      const currentState = state.getState();
      expect(currentState.changeCount).toBe(12);
      expect(currentState.recentChanges).toHaveLength(10);
      expect(currentState.recentChanges[0].path).toBe("file12.txt");
      expect(currentState.recentChanges[9].path).toBe("file3.txt");
    });

    it("should handle different change types", () => {
      state.recordChange("test1.txt", "created");
      state.recordChange("test2.txt", "modified");
      state.recordChange("test3.txt", "deleted");

      const currentState = state.getState();
      expect(currentState.recentChanges[2].type).toBe("created");
      expect(currentState.recentChanges[1].type).toBe("modified");
      expect(currentState.recentChanges[0].type).toBe("deleted");
    });

    it("should update timestamp on each change", () => {
      vi.setSystemTime(new Date("2024-01-10T10:00:00Z"));
      state.recordChange("file1.txt", "created");

      vi.setSystemTime(new Date("2024-01-10T10:05:00Z"));
      const result = state.recordChange("file2.txt", "modified");

      expect(result.updatedAt).toBe("2024-01-10T10:05:00.000Z");
    });
  });

  describe("reset", () => {
    it("should reset state to initial values", () => {
      state.recordChange("file1.txt", "created");
      state.recordChange("file2.txt", "modified");

      vi.setSystemTime(new Date("2024-01-10T11:00:00Z"));
      state.reset();

      const currentState = state.getState();
      expect(currentState.changeCount).toBe(0);
      expect(currentState.recentChanges).toEqual([]);
      expect(currentState.updatedAt).toBe("2024-01-10T11:00:00.000Z");
    });

    it("should preserve watched paths after reset", () => {
      state.setWatchedPaths(["pipeline-config", "runs"]);
      state.recordChange("file1.txt", "created");

      state.reset();

      const currentState = state.getState();
      expect(currentState.watchedPaths).toEqual(["pipeline-config", "runs"]);
      expect(currentState.changeCount).toBe(0);
    });
  });

  describe("setWatchedPaths", () => {
    it("should set watched paths", () => {
      const paths = ["pipeline-config", "runs", "tasks"];
      state.setWatchedPaths(paths);

      const currentState = state.getState();
      expect(currentState.watchedPaths).toEqual(paths);
    });

    it("should create a copy of the paths array", () => {
      const paths = ["pipeline-config"];
      state.setWatchedPaths(paths);

      paths.push("runs");

      const currentState = state.getState();
      expect(currentState.watchedPaths).toEqual(["pipeline-config"]);
    });

    it("should overwrite existing watched paths", () => {
      state.setWatchedPaths(["old-path"]);
      state.setWatchedPaths(["new-path-1", "new-path-2"]);

      const currentState = state.getState();
      expect(currentState.watchedPaths).toEqual(["new-path-1", "new-path-2"]);
    });
  });

  describe("Integration scenarios", () => {
    it("should handle a typical usage flow", () => {
      // Set watched paths
      state.setWatchedPaths(["pipeline-config", "runs"]);

      // Record some changes
      vi.setSystemTime(new Date("2024-01-10T10:00:00Z"));
      state.recordChange("pipeline-config/demo/config.yaml", "created");

      vi.setSystemTime(new Date("2024-01-10T10:00:05Z"));
      state.recordChange("pipeline-config/demo/config.yaml", "modified");

      vi.setSystemTime(new Date("2024-01-10T10:00:10Z"));
      state.recordChange("runs/run-001/output.json", "created");

      const currentState = state.getState();
      expect(currentState.changeCount).toBe(3);
      expect(currentState.watchedPaths).toEqual(["pipeline-config", "runs"]);
      expect(currentState.recentChanges).toHaveLength(3);
      expect(currentState.updatedAt).toBe("2024-01-10T10:00:10.000Z");

      // Reset and verify
      vi.setSystemTime(new Date("2024-01-10T11:00:00Z"));
      state.reset();
      const resetState = state.getState();

      expect(resetState.changeCount).toBe(0);
      expect(resetState.recentChanges).toEqual([]);
      expect(resetState.watchedPaths).toEqual(["pipeline-config", "runs"]);
      expect(resetState.updatedAt).toBe("2024-01-10T11:00:00.000Z");
    });

    it("should handle rapid successive changes", () => {
      const startTime = new Date("2024-01-10T10:00:00Z");

      for (let i = 0; i < 20; i++) {
        vi.setSystemTime(new Date(startTime.getTime() + i * 100));
        state.recordChange(
          `file${i}.txt`,
          i % 2 === 0 ? "created" : "modified"
        );
      }

      const currentState = state.getState();
      expect(currentState.changeCount).toBe(20);
      expect(currentState.recentChanges).toHaveLength(10);
      expect(currentState.recentChanges[0].path).toBe("file19.txt");
      expect(currentState.recentChanges[9].path).toBe("file10.txt");
    });
  });
});
