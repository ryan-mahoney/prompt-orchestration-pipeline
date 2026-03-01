/**
 * @vitest-environment node
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { transformJobStatus } from "../src/ui/transformers/status-transformer.js";

describe("transformJobStatus - job-level files", () => {
  const jobId = "test-job";
  const location = "current";

  describe("when raw.files is present", () => {
    it("copies arrays from raw.files to job.files", () => {
      const raw = {
        id: jobId,
        name: "Test Job",
        files: {
          artifacts: ["job-a1.json", "job-a2.json"],
          logs: ["job.log", "debug.log"],
          tmp: ["temp.txt", "scratch.dat"],
        },
        tasks: {},
      };

      const result = transformJobStatus(raw, jobId, location);

      expect(result.files).toEqual({
        artifacts: ["job-a1.json", "job-a2.json"],
        logs: ["job.log", "debug.log"],
        tmp: ["temp.txt", "scratch.dat"],
      });
    });

    it("handles empty arrays in raw.files", () => {
      const raw = {
        id: jobId,
        name: "Test Job",
        files: {
          artifacts: [],
          logs: [],
          tmp: [],
        },
        tasks: {},
      };

      const result = transformJobStatus(raw, jobId, location);

      expect(result.files).toEqual({
        artifacts: [],
        logs: [],
        tmp: [],
      });
    });

    it("handles partial files object (some arrays missing)", () => {
      const raw = {
        id: jobId,
        name: "Test Job",
        files: {
          artifacts: ["job-a1.json"],
          // logs missing
          tmp: ["temp.txt"],
        },
        tasks: {},
      };

      const result = transformJobStatus(raw, jobId, location);

      expect(result.files).toEqual({
        artifacts: ["job-a1.json"],
        logs: [],
        tmp: ["temp.txt"],
      });
    });

    it("creates copies of arrays (no reference sharing)", () => {
      const raw = {
        id: jobId,
        name: "Test Job",
        files: {
          artifacts: ["job-a1.json"],
          logs: ["job.log"],
          tmp: ["temp.txt"],
        },
        tasks: {},
      };

      const result = transformJobStatus(raw, jobId, location);

      // Modify result arrays
      result.files.artifacts.push("new-artifact.json");
      result.files.logs.push("new.log");
      result.files.tmp.push("new.tmp");

      // Original raw should be unchanged
      expect(raw.files.artifacts).toEqual(["job-a1.json"]);
      expect(raw.files.logs).toEqual(["job.log"]);
      expect(raw.files.tmp).toEqual(["temp.txt"]);
    });
  });

  describe("when raw.files is missing", () => {
    it("creates job.files with empty arrays", () => {
      const raw = {
        id: jobId,
        name: "Test Job",
        tasks: {},
        // no files property
      };

      const result = transformJobStatus(raw, jobId, location);

      expect(result.files).toEqual({
        artifacts: [],
        logs: [],
        tmp: [],
      });
    });

    it("handles raw.files being null", () => {
      const raw = {
        id: jobId,
        name: "Test Job",
        files: null,
        tasks: {},
      };

      const result = transformJobStatus(raw, jobId, location);

      expect(result.files).toEqual({
        artifacts: [],
        logs: [],
        tmp: [],
      });
    });

    it("handles raw.files being non-object", () => {
      const raw = {
        id: jobId,
        name: "Test Job",
        files: "invalid",
        tasks: {},
      };

      const result = transformJobStatus(raw, jobId, location);

      expect(result.files).toEqual({
        artifacts: [],
        logs: [],
        tmp: [],
      });
    });
  });

  describe("when raw.files has invalid array values", () => {
    it("converts non-array values to empty arrays", () => {
      const raw = {
        id: jobId,
        name: "Test Job",
        files: {
          artifacts: "not-an-array",
          logs: null,
          tmp: { not: "an-array" },
        },
        tasks: {},
      };

      const result = transformJobStatus(raw, jobId, location);

      expect(result.files).toEqual({
        artifacts: [],
        logs: [],
        tmp: [],
      });
    });

    it("handles mixed valid/invalid arrays", () => {
      const raw = {
        id: jobId,
        name: "Test Job",
        files: {
          artifacts: ["valid.json"],
          logs: "invalid",
          tmp: ["valid.txt"],
        },
        tasks: {},
      };

      const result = transformJobStatus(raw, jobId, location);

      expect(result.files).toEqual({
        artifacts: ["valid.json"],
        logs: [],
        tmp: ["valid.txt"],
      });
    });
  });

  describe("integration with other transformJobStatus features", () => {
    it("preserves other job properties alongside files", () => {
      const raw = {
        id: jobId,
        name: "Test Job",
        status: "running",
        progress: 50,
        createdAt: "2023-01-01T00:00:00Z",
        updatedAt: "2023-01-01T01:00:00Z",
        files: {
          artifacts: ["output.json"],
          logs: ["process.log"],
          tmp: ["temp.txt"],
        },
        tasks: {
          "task-1": {
            state: "done",
            files: {
              artifacts: ["task-output.json"],
              logs: [],
              tmp: [],
            },
          },
        },
      };

      const result = transformJobStatus(raw, jobId, location);

      expect(result).toMatchObject({
        id: jobId,
        name: "Test Job",
        status: "complete",
        progress: 100,
        createdAt: "2023-01-01T00:00:00Z",
        updatedAt: "2023-01-01T01:00:00Z",
        location,
        files: {
          artifacts: ["output.json"],
          logs: ["process.log"],
          tmp: ["temp.txt"],
        },
      });
      expect(result.tasks).toHaveLength(1);
      expect(result.tasks[0]).toMatchObject({
        name: "task-1",
        state: "done",
        files: {
          artifacts: ["task-output.json"],
          logs: [],
          tmp: [],
        },
      });
    });
  });
});
