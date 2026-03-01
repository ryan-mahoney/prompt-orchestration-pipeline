import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { writeAnalysisFile } from "../../src/task-analysis/enrichers/analysis-writer.js";
import { createTempDir, cleanupTempDir } from "../test-utils.js";

describe("writeAnalysisFile", () => {
  let tempDir;
  let pipelinePath;

  beforeEach(async () => {
    tempDir = await createTempDir();
    pipelinePath = path.join(tempDir, "pipeline");
    await fs.mkdir(pipelinePath, { recursive: true });
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  describe("validation", () => {
    it("throws on missing analysisData parameter", async () => {
      await expect(
        writeAnalysisFile(pipelinePath, "research", null)
      ).rejects.toThrow(
        "Invalid analysisData: expected an object but got object"
      );
    });

    it("throws on non-object analysisData", async () => {
      await expect(
        writeAnalysisFile(pipelinePath, "research", "not an object")
      ).rejects.toThrow(
        "Invalid analysisData: expected an object but got string"
      );
    });

    it("throws on missing taskFilePath property", async () => {
      await expect(
        writeAnalysisFile(pipelinePath, "research", {
          stages: [],
          artifacts: {},
          models: [],
        })
      ).rejects.toThrow(
        "Invalid analysisData.taskFilePath: expected a string but got undefined"
      );
    });

    it("throws on non-string taskFilePath", async () => {
      await expect(
        writeAnalysisFile(pipelinePath, "research", {
          taskFilePath: 123,
          stages: [],
          artifacts: {},
          models: [],
        })
      ).rejects.toThrow(
        "Invalid analysisData.taskFilePath: expected a string but got number"
      );
    });

    it("throws on missing stages array", async () => {
      await expect(
        writeAnalysisFile(pipelinePath, "research", {
          taskFilePath: "tasks/research.js",
          artifacts: {},
          models: [],
        })
      ).rejects.toThrow(
        "Invalid analysisData.stages: expected an array but got undefined"
      );
    });

    it("throws on non-array stages", async () => {
      await expect(
        writeAnalysisFile(pipelinePath, "research", {
          taskFilePath: "tasks/research.js",
          stages: "not an array",
          artifacts: {},
          models: [],
        })
      ).rejects.toThrow(
        "Invalid analysisData.stages: expected an array but got string"
      );
    });

    it("throws on missing artifacts object", async () => {
      await expect(
        writeAnalysisFile(pipelinePath, "research", {
          taskFilePath: "tasks/research.js",
          stages: [],
          models: [],
        })
      ).rejects.toThrow(
        "Invalid analysisData.artifacts: expected an object but got undefined"
      );
    });

    it("throws on non-object artifacts", async () => {
      await expect(
        writeAnalysisFile(pipelinePath, "research", {
          taskFilePath: "tasks/research.js",
          stages: [],
          artifacts: [],
          models: [],
        })
      ).rejects.toThrow(
        "Invalid analysisData.artifacts: expected an object but got object"
      );
    });

    it("throws on missing models array", async () => {
      await expect(
        writeAnalysisFile(pipelinePath, "research", {
          taskFilePath: "tasks/research.js",
          stages: [],
          artifacts: {},
        })
      ).rejects.toThrow(
        "Invalid analysisData.models: expected an array but got undefined"
      );
    });

    it("throws on non-array models", async () => {
      await expect(
        writeAnalysisFile(pipelinePath, "research", {
          taskFilePath: "tasks/research.js",
          stages: [],
          artifacts: {},
          models: {},
        })
      ).rejects.toThrow(
        "Invalid analysisData.models: expected an array but got object"
      );
    });
  });

  describe("directory creation", () => {
    it("creates analysis directory if it doesn't exist", async () => {
      const analysisDir = path.join(pipelinePath, "analysis");

      // Verify directory doesn't exist yet
      await expect(fs.stat(analysisDir)).rejects.toThrow();

      await writeAnalysisFile(pipelinePath, "research", {
        taskFilePath: "tasks/research.js",
        stages: [],
        artifacts: {},
        models: [],
      });

      // Verify directory was created
      const stats = await fs.stat(analysisDir);
      expect(stats.isDirectory()).toBe(true);
    });

    it("uses existing analysis directory if it already exists", async () => {
      const analysisDir = path.join(pipelinePath, "analysis");
      await fs.mkdir(analysisDir, { recursive: true });

      // Create a marker file
      const markerFile = path.join(analysisDir, "existing.txt");
      await fs.writeFile(markerFile, "existing content");

      await writeAnalysisFile(pipelinePath, "research", {
        taskFilePath: "tasks/research.js",
        stages: [],
        artifacts: {},
        models: [],
      });

      // Verify existing file is still there
      const markerContent = await fs.readFile(markerFile, "utf-8");
      expect(markerContent).toBe("existing content");

      // Verify new file was created
      await expect(
        fs.stat(path.join(analysisDir, "research.analysis.json"))
      ).resolves.toBeDefined();
    });

    it("creates nested directory structure when parent directories don't exist", async () => {
      // Use a deeply nested pipeline path that doesn't exist
      const deepPath = path.join(tempDir, "a", "b", "c", "pipeline");

      // Path doesn't exist yet
      await expect(fs.stat(deepPath)).rejects.toThrow();

      await writeAnalysisFile(deepPath, "research", {
        taskFilePath: "tasks/research.js",
        stages: [],
        artifacts: {},
        models: [],
      });

      // Verify entire path was created
      const analysisDir = path.join(deepPath, "analysis");
      const stats = await fs.stat(analysisDir);
      expect(stats.isDirectory()).toBe(true);
    });
  });

  describe("file writing", () => {
    it("writes valid JSON with analyzedAt timestamp", async () => {
      const beforeTime = new Date().toISOString();

      const analysisData = {
        taskFilePath: "tasks/research.js",
        stages: [
          { name: "ingestion", order: 1, isAsync: true },
          { name: "processing", order: 2, isAsync: false },
        ],
        artifacts: {
          reads: [
            { fileName: "input.json", stage: "ingestion", required: true },
          ],
          writes: [{ fileName: "output.json", stage: "processing" }],
        },
        models: [{ provider: "deepseek", method: "chat", stage: "ingestion" }],
      };

      await writeAnalysisFile(pipelinePath, "research", analysisData);

      const afterTime = new Date().toISOString();

      const analysisFile = path.join(
        pipelinePath,
        "analysis",
        "research.analysis.json"
      );
      const content = JSON.parse(await fs.readFile(analysisFile, "utf-8"));

      // Verify all original data is present
      expect(content.taskFilePath).toBe(analysisData.taskFilePath);
      expect(content.stages).toEqual(analysisData.stages);
      expect(content.artifacts).toEqual(analysisData.artifacts);
      expect(content.models).toEqual(analysisData.models);

      // Verify analyzedAt was added
      expect(content.analyzedAt).toBeDefined();
      const analyzedDate = new Date(content.analyzedAt);
      expect(analyzedDate).toBeInstanceOf(Date);
      expect(isNaN(analyzedDate.getTime())).toBe(false);

      // Verify timestamp is reasonable
      expect(content.analyzedAt >= beforeTime).toBe(true);
      expect(content.analyzedAt <= afterTime).toBe(true);
    });

    it("uses correct filename pattern [taskName].analysis.json", async () => {
      await writeAnalysisFile(pipelinePath, "my-task", {
        taskFilePath: "tasks/my-task.js",
        stages: [],
        artifacts: {},
        models: [],
      });

      const analysisFile = path.join(
        pipelinePath,
        "analysis",
        "my-task.analysis.json"
      );
      await expect(fs.stat(analysisFile)).resolves.toBeDefined();
    });

    it("formats JSON with proper 2-space indentation", async () => {
      const analysisData = {
        taskFilePath: "tasks/research.js",
        stages: [{ name: "ingestion", order: 1 }],
        artifacts: { reads: [], writes: [] },
        models: [],
      };

      await writeAnalysisFile(pipelinePath, "research", analysisData);

      const analysisFile = path.join(
        pipelinePath,
        "analysis",
        "research.analysis.json"
      );
      const content = await fs.readFile(analysisFile, "utf-8");

      // Verify proper JSON formatting with 2-space indentation
      expect(content).toContain("{\n  ");
      expect(content).toContain('  "taskFilePath"');
    });

    it("preserves all fields from analysisData", async () => {
      const analysisData = {
        taskFilePath: "tasks/complex.js",
        stages: [
          { name: "ingestion", order: 1, isAsync: true },
          { name: "processing", order: 2, isAsync: false },
          { name: "output", order: 3, isAsync: true },
        ],
        artifacts: {
          reads: [
            { fileName: "input.json", stage: "ingestion", required: true },
            { fileName: "config.json", stage: "processing", required: false },
          ],
          writes: [
            { fileName: "intermediate.json", stage: "processing" },
            { fileName: "final.json", stage: "output" },
          ],
        },
        models: [
          { provider: "deepseek", method: "chat", stage: "ingestion" },
          { provider: "openai", method: "completion", stage: "processing" },
        ],
      };

      await writeAnalysisFile(pipelinePath, "complex", analysisData);

      const analysisFile = path.join(
        pipelinePath,
        "analysis",
        "complex.analysis.json"
      );
      const content = JSON.parse(await fs.readFile(analysisFile, "utf-8"));

      // Verify all fields preserved (except analyzedAt which is new)
      expect(content.taskFilePath).toEqual(analysisData.taskFilePath);
      expect(content.stages).toEqual(analysisData.stages);
      expect(content.artifacts).toEqual(analysisData.artifacts);
      expect(content.models).toEqual(analysisData.models);
      expect(content.analyzedAt).toBeDefined();
    });
  });

  describe("multiple invocations", () => {
    it("overwrites existing file on subsequent calls", async () => {
      const firstData = {
        taskFilePath: "tasks/research.js",
        stages: [{ name: "ingestion", order: 1 }],
        artifacts: { reads: [], writes: [] },
        models: [],
      };

      await writeAnalysisFile(pipelinePath, "research", firstData);

      const secondData = {
        taskFilePath: "tasks/research-v2.js",
        stages: [
          { name: "ingestion", order: 1 },
          { name: "processing", order: 2 },
        ],
        artifacts: {
          reads: [],
          writes: [{ fileName: "output.json", stage: "processing" }],
        },
        models: [{ provider: "deepseek", method: "chat", stage: "ingestion" }],
      };

      await writeAnalysisFile(pipelinePath, "research", secondData);

      // Verify file contains second version
      const analysisFile = path.join(
        pipelinePath,
        "analysis",
        "research.analysis.json"
      );
      const content = JSON.parse(await fs.readFile(analysisFile, "utf-8"));

      expect(content.taskFilePath).toBe(secondData.taskFilePath);
      expect(content.stages).toEqual(secondData.stages);
      expect(content.artifacts).toEqual(secondData.artifacts);
      expect(content.models).toEqual(secondData.models);
    });

    it("can write multiple task analyses independently", async () => {
      await writeAnalysisFile(pipelinePath, "task1", {
        taskFilePath: "tasks/task1.js",
        stages: [{ name: "ingestion", order: 1 }],
        artifacts: { reads: [], writes: [] },
        models: [],
      });

      await writeAnalysisFile(pipelinePath, "task2", {
        taskFilePath: "tasks/task2.js",
        stages: [{ name: "processing", order: 1 }],
        artifacts: { reads: [], writes: [] },
        models: [],
      });

      // Verify both files exist
      const analysisDir = path.join(pipelinePath, "analysis");
      await expect(
        fs.stat(path.join(analysisDir, "task1.analysis.json"))
      ).resolves.toBeDefined();
      await expect(
        fs.stat(path.join(analysisDir, "task2.analysis.json"))
      ).resolves.toBeDefined();

      // Verify they have different content
      const content1 = JSON.parse(
        await fs.readFile(
          path.join(analysisDir, "task1.analysis.json"),
          "utf-8"
        )
      );
      const content2 = JSON.parse(
        await fs.readFile(
          path.join(analysisDir, "task2.analysis.json"),
          "utf-8"
        )
      );

      expect(content1.taskFilePath).toBe("tasks/task1.js");
      expect(content2.taskFilePath).toBe("tasks/task2.js");
      expect(content1.stages[0].name).toBe("ingestion");
      expect(content2.stages[0].name).toBe("processing");
    });
  });

  describe("edge cases", () => {
    it("handles empty arrays and objects", async () => {
      const analysisData = {
        taskFilePath: "tasks/simple.js",
        stages: [],
        artifacts: {},
        models: [],
      };

      await writeAnalysisFile(pipelinePath, "simple", analysisData);

      const analysisFile = path.join(
        pipelinePath,
        "analysis",
        "simple.analysis.json"
      );
      const content = JSON.parse(await fs.readFile(analysisFile, "utf-8"));

      expect(content.stages).toEqual([]);
      expect(content.artifacts).toEqual({});
      expect(content.models).toEqual([]);
    });

    it("handles task names with special characters", async () => {
      await writeAnalysisFile(pipelinePath, "my-task_v2", {
        taskFilePath: "tasks/my-task_v2.js",
        stages: [],
        artifacts: {},
        models: [],
      });

      const analysisFile = path.join(
        pipelinePath,
        "analysis",
        "my-task_v2.analysis.json"
      );
      await expect(fs.stat(analysisFile)).resolves.toBeDefined();
    });

    it("handles complex nested artifact structures", async () => {
      const analysisData = {
        taskFilePath: "tasks/complex.js",
        stages: [
          {
            name: "ingestion",
            order: 1,
            isAsync: true,
            metadata: { description: "Loads data" },
          },
        ],
        artifacts: {
          reads: [
            {
              fileName: "input.json",
              stage: "ingestion",
              required: true,
              schema: {
                type: "object",
                properties: { id: { type: "number" } },
              },
            },
          ],
          writes: [
            {
              fileName: "output.json",
              stage: "ingestion",
              format: "json",
              schema: {
                type: "array",
                items: {
                  type: "object",
                  properties: { name: { type: "string" } },
                },
              },
            },
          ],
        },
        models: [
          {
            provider: "deepseek",
            method: "chat",
            stage: "ingestion",
            config: { temperature: 0.7 },
          },
        ],
      };

      await writeAnalysisFile(pipelinePath, "complex", analysisData);

      const analysisFile = path.join(
        pipelinePath,
        "analysis",
        "complex.analysis.json"
      );
      const content = JSON.parse(await fs.readFile(analysisFile, "utf-8"));

      expect(content.stages).toEqual(analysisData.stages);
      expect(content.artifacts).toEqual(analysisData.artifacts);
      expect(content.models).toEqual(analysisData.models);
    });
  });
});
