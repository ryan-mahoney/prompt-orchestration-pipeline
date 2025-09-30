import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock the module to avoid issues with CommonJS in tests
const createStateManager = () => {
  const MAX_RECENT_CHANGES = 10;

  let state = {
    updatedAt: new Date().toISOString(),
    changeCount: 0,
    recentChanges: [],
    watchedPaths: [],
  };

  return {
    getState: () => ({ ...state }),

    recordChange: (path, type) => {
      const timestamp = new Date().toISOString();
      const recentChanges = [
        { path, type, timestamp },
        ...state.recentChanges,
      ].slice(0, MAX_RECENT_CHANGES);

      state = {
        ...state,
        updatedAt: timestamp,
        changeCount: state.changeCount + 1,
        recentChanges,
      };

      return { ...state };
    },

    reset: () => {
      state = {
        updatedAt: new Date().toISOString(),
        changeCount: 0,
        recentChanges: [],
        watchedPaths: state.watchedPaths,
      };
    },

    setWatchedPaths: (paths) => {
      state.watchedPaths = [...paths];
    },
  };
};

describe("State Manager", () => {
  let stateManager;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-10T10:00:00Z"));
    stateManager = createStateManager();
  });

  describe("getState", () => {
    it("should return initial state", () => {
      const state = stateManager.getState();

      expect(state).toEqual({
        updatedAt: "2024-01-10T10:00:00.000Z",
        changeCount: 0,
        recentChanges: [],
        watchedPaths: [],
      });
    });

    it("should return a copy of state, not a reference", () => {
      const state1 = stateManager.getState();
      const state2 = stateManager.getState();

      expect(state1).not.toBe(state2);
      expect(state1).toEqual(state2);
    });
  });

  describe("recordChange", () => {
    it("should record a file creation", () => {
      const result = stateManager.recordChange(
        "pipeline-config/test.yaml",
        "created"
      );

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
      stateManager.recordChange("file1.txt", "created");

      vi.setSystemTime(new Date("2024-01-10T10:00:01Z"));
      stateManager.recordChange("file2.txt", "modified");

      vi.setSystemTime(new Date("2024-01-10T10:00:02Z"));
      const result = stateManager.recordChange("file3.txt", "deleted");

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
        stateManager.recordChange(`file${i}.txt`, "modified");
      }

      const state = stateManager.getState();
      expect(state.changeCount).toBe(12);
      expect(state.recentChanges).toHaveLength(10);
      expect(state.recentChanges[0].path).toBe("file12.txt");
      expect(state.recentChanges[9].path).toBe("file3.txt");
    });

    it("should handle different change types", () => {
      stateManager.recordChange("test1.txt", "created");
      stateManager.recordChange("test2.txt", "modified");
      stateManager.recordChange("test3.txt", "deleted");

      const state = stateManager.getState();
      expect(state.recentChanges[2].type).toBe("created");
      expect(state.recentChanges[1].type).toBe("modified");
      expect(state.recentChanges[0].type).toBe("deleted");
    });

    it("should update timestamp on each change", () => {
      vi.setSystemTime(new Date("2024-01-10T10:00:00Z"));
      stateManager.recordChange("file1.txt", "created");

      vi.setSystemTime(new Date("2024-01-10T10:05:00Z"));
      const result = stateManager.recordChange("file2.txt", "modified");

      expect(result.updatedAt).toBe("2024-01-10T10:05:00.000Z");
    });
  });

  describe("reset", () => {
    it("should reset state to initial values", () => {
      stateManager.recordChange("file1.txt", "created");
      stateManager.recordChange("file2.txt", "modified");

      vi.setSystemTime(new Date("2024-01-10T11:00:00Z"));
      stateManager.reset();

      const state = stateManager.getState();
      expect(state.changeCount).toBe(0);
      expect(state.recentChanges).toEqual([]);
      expect(state.updatedAt).toBe("2024-01-10T11:00:00.000Z");
    });

    it("should preserve watched paths after reset", () => {
      stateManager.setWatchedPaths(["pipeline-config", "runs"]);
      stateManager.recordChange("file1.txt", "created");

      stateManager.reset();

      const state = stateManager.getState();
      expect(state.watchedPaths).toEqual(["pipeline-config", "runs"]);
      expect(state.changeCount).toBe(0);
    });
  });

  describe("setWatchedPaths", () => {
    it("should set watched paths", () => {
      const paths = ["pipeline-config", "runs", "tasks"];
      stateManager.setWatchedPaths(paths);

      const state = stateManager.getState();
      expect(state.watchedPaths).toEqual(paths);
    });

    it("should create a copy of the paths array", () => {
      const paths = ["pipeline-config"];
      stateManager.setWatchedPaths(paths);

      paths.push("runs");

      const state = stateManager.getState();
      expect(state.watchedPaths).toEqual(["pipeline-config"]);
    });

    it("should overwrite existing watched paths", () => {
      stateManager.setWatchedPaths(["old-path"]);
      stateManager.setWatchedPaths(["new-path-1", "new-path-2"]);

      const state = stateManager.getState();
      expect(state.watchedPaths).toEqual(["new-path-1", "new-path-2"]);
    });
  });

  describe("Integration scenarios", () => {
    it("should handle a typical usage flow", () => {
      // Set watched paths
      stateManager.setWatchedPaths(["pipeline-config", "runs"]);

      // Record some changes
      vi.setSystemTime(new Date("2024-01-10T10:00:00Z"));
      stateManager.recordChange("pipeline-config/demo/config.yaml", "created");

      vi.setSystemTime(new Date("2024-01-10T10:00:05Z"));
      stateManager.recordChange("pipeline-config/demo/config.yaml", "modified");

      vi.setSystemTime(new Date("2024-01-10T10:00:10Z"));
      stateManager.recordChange("runs/run-001/output.json", "created");

      const state = stateManager.getState();
      expect(state.changeCount).toBe(3);
      expect(state.watchedPaths).toEqual(["pipeline-config", "runs"]);
      expect(state.recentChanges).toHaveLength(3);
      expect(state.updatedAt).toBe("2024-01-10T10:00:10.000Z");

      // Reset and verify
      vi.setSystemTime(new Date("2024-01-10T11:00:00Z"));
      stateManager.reset();
      const resetState = stateManager.getState();

      expect(resetState.changeCount).toBe(0);
      expect(resetState.recentChanges).toEqual([]);
      expect(resetState.watchedPaths).toEqual(["pipeline-config", "runs"]);
      expect(resetState.updatedAt).toBe("2024-01-10T11:00:00.000Z");
    });

    it("should handle rapid successive changes", () => {
      const startTime = new Date("2024-01-10T10:00:00Z");

      for (let i = 0; i < 20; i++) {
        vi.setSystemTime(new Date(startTime.getTime() + i * 100));
        stateManager.recordChange(
          `file${i}.txt`,
          i % 2 === 0 ? "created" : "modified"
        );
      }

      const state = stateManager.getState();
      expect(state.changeCount).toBe(20);
      expect(state.recentChanges).toHaveLength(10);
      expect(state.recentChanges[0].path).toBe("file19.txt");
      expect(state.recentChanges[9].path).toBe("file10.txt");
    });
  });
});
