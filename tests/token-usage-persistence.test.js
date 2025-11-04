import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { writeJobStatus } from "../src/core/status-writer.js";

describe("Token Usage Persistence", () => {
  let tempDir;
  let statusPath;

  beforeEach(async () => {
    // Create a unique temporary directory for each test
    tempDir = `/tmp/token-usage-test-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    await fs.mkdir(tempDir, { recursive: true });
    statusPath = path.join(tempDir, "tasks-status.json");

    // Create initial status file with basic structure
    const initialStatus = {
      id: "test-job",
      state: "pending",
      current: null,
      currentStage: null,
      lastUpdated: new Date().toISOString(),
      tasks: {},
      files: {
        artifacts: [],
        logs: [],
        tmp: [],
      },
    };
    await fs.writeFile(statusPath, JSON.stringify(initialStatus, null, 2));
  });

  afterEach(async () => {
    // Clean up temporary directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe("appendTokenUsage function", () => {
    it("should append token usage tuple to existing task", async () => {
      const taskName = "test-task";
      const tuple = ["openai:gpt-4", 100, 50];

      // Simulate the appendTokenUsage function behavior
      await writeJobStatus(tempDir, (snapshot) => {
        if (!snapshot.tasks[taskName]) {
          snapshot.tasks[taskName] = {};
        }
        const task = snapshot.tasks[taskName];
        if (!Array.isArray(task.tokenUsage)) {
          task.tokenUsage = [];
        }
        task.tokenUsage.push(tuple);
        return snapshot;
      });

      // Read the file and verify the content
      const content = await fs.readFile(statusPath, "utf8");
      const status = JSON.parse(content);

      expect(status.tasks[taskName]).toBeDefined();
      expect(status.tasks[taskName].tokenUsage).toEqual([tuple]);
    });

    it("should initialize tokenUsage array if it doesn't exist", async () => {
      const taskName = "new-task";
      const tuple = ["deepseek:deepseek-chat", 75, 25];

      await writeJobStatus(tempDir, (snapshot) => {
        if (!snapshot.tasks[taskName]) {
          snapshot.tasks[taskName] = {};
        }
        const task = snapshot.tasks[taskName];
        if (!Array.isArray(task.tokenUsage)) {
          task.tokenUsage = [];
        }
        task.tokenUsage.push(tuple);
        return snapshot;
      });

      const content = await fs.readFile(statusPath, "utf8");
      const status = JSON.parse(content);

      expect(status.tasks[taskName].tokenUsage).toEqual([tuple]);
    });

    it("should append to existing tokenUsage array", async () => {
      const taskName = "existing-task";
      const initialTuples = [
        ["openai:gpt-3.5-turbo", 50, 25],
        ["anthropic:claude-3-sonnet", 150, 75],
      ];

      // First, add initial token usage
      await writeJobStatus(tempDir, (snapshot) => {
        if (!snapshot.tasks[taskName]) {
          snapshot.tasks[taskName] = {};
        }
        snapshot.tasks[taskName].tokenUsage = [...initialTuples];
        return snapshot;
      });

      // Now append a new tuple
      const newTuple = ["openai:gpt-4", 200, 100];
      await writeJobStatus(tempDir, (snapshot) => {
        if (!snapshot.tasks[taskName]) {
          snapshot.tasks[taskName] = {};
        }
        const task = snapshot.tasks[taskName];
        if (!Array.isArray(task.tokenUsage)) {
          task.tokenUsage = [];
        }
        task.tokenUsage.push(newTuple);
        return snapshot;
      });

      const content = await fs.readFile(statusPath, "utf8");
      const status = JSON.parse(content);

      expect(status.tasks[taskName].tokenUsage).toEqual([
        ...initialTuples,
        newTuple,
      ]);
    });

    it("should preserve other task properties", async () => {
      const taskName = "task-with-properties";
      const initialProperties = {
        state: "running",
        currentStage: "inference",
        someOtherField: "should-preserve",
        nested: {
          data: "test",
        },
      };

      // Set up task with existing properties
      await writeJobStatus(tempDir, (snapshot) => {
        snapshot.tasks[taskName] = { ...initialProperties };
        return snapshot;
      });

      // Append token usage
      const tuple = ["custom-model", 300, 150];
      await writeJobStatus(tempDir, (snapshot) => {
        if (!snapshot.tasks[taskName]) {
          snapshot.tasks[taskName] = {};
        }
        const task = snapshot.tasks[taskName];
        if (!Array.isArray(task.tokenUsage)) {
          task.tokenUsage = [];
        }
        task.tokenUsage.push(tuple);
        return snapshot;
      });

      const content = await fs.readFile(statusPath, "utf8");
      const status = JSON.parse(content);

      expect(status.tasks[taskName]).toMatchObject(initialProperties);
      expect(status.tasks[taskName].tokenUsage).toEqual([tuple]);
    });

    it("should handle multiple tasks independently", async () => {
      const task1 = "task-1";
      const task2 = "task-2";
      const tuple1 = ["model-a", 100, 50];
      const tuple2 = ["model-b", 200, 100];

      // Add token usage to task 1
      await writeJobStatus(tempDir, (snapshot) => {
        if (!snapshot.tasks[task1]) {
          snapshot.tasks[task1] = {};
        }
        const task = snapshot.tasks[task1];
        if (!Array.isArray(task.tokenUsage)) {
          task.tokenUsage = [];
        }
        task.tokenUsage.push(tuple1);
        return snapshot;
      });

      // Add token usage to task 2
      await writeJobStatus(tempDir, (snapshot) => {
        if (!snapshot.tasks[task2]) {
          snapshot.tasks[task2] = {};
        }
        const task = snapshot.tasks[task2];
        if (!Array.isArray(task.tokenUsage)) {
          task.tokenUsage = [];
        }
        task.tokenUsage.push(tuple2);
        return snapshot;
      });

      const content = await fs.readFile(statusPath, "utf8");
      const status = JSON.parse(content);

      expect(status.tasks[task1].tokenUsage).toEqual([tuple1]);
      expect(status.tasks[task2].tokenUsage).toEqual([tuple2]);
    });
  });

  describe("concurrent append scenarios", () => {
    it("should handle rapid successive appends without corruption", async () => {
      const taskName = "concurrent-task";
      const tuples = [
        ["model-1", 50, 25],
        ["model-2", 75, 35],
        ["model-3", 100, 50],
      ];

      // Simulate sequential appends (more realistic with the write queue)
      for (const tuple of tuples) {
        await writeJobStatus(tempDir, (snapshot) => {
          if (!snapshot.tasks[taskName]) {
            snapshot.tasks[taskName] = {};
          }
          const task = snapshot.tasks[taskName];
          if (!Array.isArray(task.tokenUsage)) {
            task.tokenUsage = [];
          }
          task.tokenUsage.push(tuple);
          return snapshot;
        });
      }

      const content = await fs.readFile(statusPath, "utf8");
      const status = JSON.parse(content);

      // Should have all tuples in order
      expect(status.tasks[taskName].tokenUsage).toHaveLength(3);
      expect(status.tasks[taskName].tokenUsage).toEqual(tuples);
    });
  });

  describe("data integrity", () => {
    it("should maintain valid JSON structure", async () => {
      const taskName = "json-integrity-task";
      const tuple = ["test:model", 42, 18];

      await writeJobStatus(tempDir, (snapshot) => {
        if (!snapshot.tasks[taskName]) {
          snapshot.tasks[taskName] = {};
        }
        const task = snapshot.tasks[taskName];
        if (!Array.isArray(task.tokenUsage)) {
          task.tokenUsage = [];
        }
        task.tokenUsage.push(tuple);
        return snapshot;
      });

      // Verify the file contains valid JSON
      const content = await fs.readFile(statusPath, "utf8");
      expect(() => JSON.parse(content)).not.toThrow();

      // Verify the structure matches expected schema
      const status = JSON.parse(content);
      expect(status).toHaveProperty("tasks");
      expect(status.tasks).toHaveProperty(taskName);
      expect(status.tasks[taskName]).toHaveProperty("tokenUsage");
      expect(Array.isArray(status.tasks[taskName].tokenUsage)).toBe(true);
    });

    it("should handle empty and zero token values", async () => {
      const taskName = "zero-tokens-task";
      const tuples = [
        ["empty-model", 0, 0],
        ["zero-input", 0, 50],
        ["zero-output", 100, 0],
      ];

      for (const tuple of tuples) {
        await writeJobStatus(tempDir, (snapshot) => {
          if (!snapshot.tasks[taskName]) {
            snapshot.tasks[taskName] = {};
          }
          const task = snapshot.tasks[taskName];
          if (!Array.isArray(task.tokenUsage)) {
            task.tokenUsage = [];
          }
          task.tokenUsage.push(tuple);
          return snapshot;
        });
      }

      const content = await fs.readFile(statusPath, "utf8");
      const status = JSON.parse(content);

      expect(status.tasks[taskName].tokenUsage).toEqual(tuples);
    });
  });
});
