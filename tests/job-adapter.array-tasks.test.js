import { describe, it, expect } from "vitest";
import { adaptJobDetail } from "../src/ui/client/adapters/job-adapter.js";

describe("adaptJobDetail - Object Tasks Validation", () => {
  it("returns tasks as object with names and valid states", () => {
    const apiDetail = {
      id: "test-job",
      name: "Test Job",
      tasks: {
        research: { state: "done", startedAt: "2025-10-06T00:00:00Z" },
        analysis: {
          state: "running",
          startedAt: "2025-10-06T00:05:00Z",
        },
        synthesis: { state: "pending" },
      },
    };

    const result = adaptJobDetail(apiDetail);

    expect(typeof result.tasks).toBe("object");
    expect(result.tasks).not.toBeNull();
    expect(Object.keys(result.tasks)).toHaveLength(3);

    // Check each task has required properties
    Object.entries(result.tasks).forEach(([taskName, task]) => {
      expect(taskName).toBe(task.name); // Key should match task name
      expect(task).toHaveProperty("name");
      expect(task).toHaveProperty("state");
      expect(typeof task.name).toBe("string");
      expect(typeof task.state).toBe("string");
      expect(["pending", "running", "done", "error"]).toContain(task.state);
    });

    // Check specific tasks
    expect(result.tasks.research).toEqual({
      name: "research",
      state: "done",
      startedAt: "2025-10-06T00:00:00Z",
      endedAt: null,
      attempts: undefined,
      executionTimeMs: undefined,
      files: {
        artifacts: [],
        logs: [],
        tmp: [],
      },
      artifacts: undefined,
    });

    expect(result.tasks.analysis).toEqual({
      name: "analysis",
      state: "running",
      startedAt: "2025-10-06T00:05:00Z",
      endedAt: null,
      attempts: undefined,
      executionTimeMs: undefined,
      files: {
        artifacts: [],
        logs: [],
        tmp: [],
      },
      artifacts: undefined,
    });

    expect(result.tasks.synthesis).toEqual({
      name: "synthesis",
      state: "pending",
      startedAt: null,
      endedAt: null,
      attempts: undefined,
      executionTimeMs: undefined,
      files: {
        artifacts: [],
        logs: [],
        tmp: [],
      },
      artifacts: undefined,
    });
  });

  it("normalizes invalid task states to pending", () => {
    const apiDetail = {
      id: "test-job",
      name: "Test Job",
      tasks: {
        task1: { state: "invalid_state" },
        task2: { state: "" },
        task3: { state: null },
        task4: {}, // missing state
      },
    };

    const result = adaptJobDetail(apiDetail);

    expect(typeof result.tasks).toBe("object");
    expect(Object.keys(result.tasks)).toHaveLength(4);

    Object.values(result.tasks).forEach((task) => {
      expect(task.state).toBe("pending");
    });

    // Should have warnings for invalid states
    expect(result.__warnings).toBeDefined();
    expect(result.__warnings).toContain("task1:unknown_state:invalid_state");
    expect(result.__warnings).toContain("task2:missing_state");
  });

  it("preserves additional task properties when present", () => {
    const apiDetail = {
      id: "test-job",
      name: "Test Job",
      tasks: {
        "complex-task": {
          state: "done",
          startedAt: "2025-10-06T00:00:00Z",
          endedAt: "2025-10-06T00:05:00Z",
          attempts: 3,
          executionTimeMs: 5000,
          artifacts: ["output.json", "logs.txt"],
          config: { model: "gpt-4", temperature: 0.7 },
        },
      },
    };

    const result = adaptJobDetail(apiDetail);

    expect(typeof result.tasks).toBe("object");
    expect(Object.keys(result.tasks)).toHaveLength(1);

    const task = result.tasks["complex-task"];
    expect(task.name).toBe("complex-task");
    expect(task.state).toBe("done");
    expect(task.startedAt).toBe("2025-10-06T00:00:00Z");
    expect(task.endedAt).toBe("2025-10-06T00:05:00Z");
    expect(task.attempts).toBe(3);
    expect(task.executionTimeMs).toBe(5000);
    expect(task.artifacts).toEqual(["output.json", "logs.txt"]);
  });

  it("handles empty tasks object", () => {
    const apiDetail = {
      id: "test-job",
      name: "Test Job",
      tasks: {},
    };

    const result = adaptJobDetail(apiDetail);

    expect(typeof result.tasks).toBe("object");
    expect(Object.keys(result.tasks)).toHaveLength(0);
    expect(result.taskCount).toBe(0);
    expect(result.doneCount).toBe(0);
  });

  it("handles missing tasks property", () => {
    const apiDetail = {
      id: "test-job",
      name: "Test Job",
      // no tasks property
    };

    const result = adaptJobDetail(apiDetail);

    expect(typeof result.tasks).toBe("object");
    expect(Object.keys(result.tasks)).toHaveLength(0);
    expect(result.taskCount).toBe(0);
    expect(result.doneCount).toBe(0);
  });

  it("handles null tasks property", () => {
    const apiDetail = {
      id: "test-job",
      name: "Test Job",
      tasks: null,
    };

    const result = adaptJobDetail(apiDetail);

    expect(typeof result.tasks).toBe("object");
    expect(Object.keys(result.tasks)).toHaveLength(0);
    expect(result.taskCount).toBe(0);
    expect(result.doneCount).toBe(0);
  });

  it("computes progress and status from object tasks", () => {
    const apiDetail = {
      id: "test-job",
      name: "Test Job",
      tasks: {
        task1: { state: "done" },
        task2: { state: "running" },
        task3: { state: "pending" },
        task4: { state: "error" },
      },
    };

    const result = adaptJobDetail(apiDetail);

    // Should have error status due to error task
    expect(result.status).toBe("error");

    // Progress should be 25% (1 done out of 4 tasks)
    expect(result.progress).toBe(25);

    expect(result.taskCount).toBe(4);
    expect(result.doneCount).toBe(1);
  });

  it("includes pipeline property when present in API response", () => {
    const apiDetail = {
      id: "test-job",
      name: "Test Job",
      tasks: {
        task1: { state: "done" },
        task2: { state: "pending" },
      },
      pipeline: {
        tasks: ["task1", "task2"],
      },
    };

    const result = adaptJobDetail(apiDetail);

    expect(result.pipeline).toBeDefined();
    expect(result.pipeline.tasks).toEqual(["task1", "task2"]);
  });
});
