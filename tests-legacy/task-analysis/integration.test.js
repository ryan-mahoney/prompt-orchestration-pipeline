import { describe, it, expect } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { analyzeTask } from "../../src/task-analysis/index.js";

const TASKS_DIR = path.join(
  process.cwd(),
  "demo/pipeline-config/content-generation/tasks"
);

async function readTaskFile(filename) {
  const filePath = path.join(TASKS_DIR, filename);
  return await fs.readFile(filePath, "utf8");
}

describe("analyzeTask - integration tests with real task files", () => {
  describe("analysis.js", () => {
    it("extracts correct stages", async () => {
      const code = await readTaskFile("analysis.js");
      const result = analyzeTask(code);

      expect(result.stages).toHaveLength(4);
      expect(result.stages.map((s) => s.name)).toEqual([
        "ingestion",
        "promptTemplating",
        "inference",
        "validateStructure",
      ]);

      expect(result.stages[0].isAsync).toBe(true);
      expect(result.stages[2].isAsync).toBe(true);
      expect(result.stages[3].isAsync).toBe(true);
    });

    it("extracts artifact reads", async () => {
      const code = await readTaskFile("analysis.js");
      const result = analyzeTask(code);

      expect(result.artifacts.reads).toHaveLength(2);
      expect(result.artifacts.reads).toContainEqual({
        fileName: "research-output.json",
        stage: "ingestion",
        required: true,
      });
      expect(result.artifacts.reads).toContainEqual({
        fileName: "analysis-output.json",
        stage: "validateStructure",
        required: true,
      });
    });

    it("extracts artifact writes", async () => {
      const code = await readTaskFile("analysis.js");
      const result = analyzeTask(code);

      expect(result.artifacts.writes).toHaveLength(1);
      expect(result.artifacts.writes).toContainEqual({
        fileName: "analysis-output.json",
        stage: "inference",
      });
    });

    it("extracts LLM calls", async () => {
      const code = await readTaskFile("analysis.js");
      const result = analyzeTask(code);

      expect(result.models).toHaveLength(1);
      expect(result.models).toContainEqual({
        provider: "gemini",
        method: "flash25",
        stage: "inference",
      });
    });
  });

  describe("research.js", () => {
    it("extracts correct stages", async () => {
      const code = await readTaskFile("research.js");
      const result = analyzeTask(code);

      expect(result.stages).toHaveLength(11);
      expect(result.stages.map((s) => s.name)).toEqual([
        "ingestion",
        "preProcessing",
        "promptTemplating",
        "inference",
        "parsing",
        "validateStructure",
        "validateQuality",
        "critique",
        "refine",
        "finalValidation",
        "integration",
      ]);

      expect(result.stages[3].isAsync).toBe(true); // inference
      expect(result.stages[5].isAsync).toBe(true); // validateStructure
      expect(result.stages[7].isAsync).toBe(true); // critique
      expect(result.stages[8].isAsync).toBe(true); // refine
      expect(result.stages[9].isAsync).toBe(true); // finalValidation
    });

    it("extracts artifact reads", async () => {
      const code = await readTaskFile("research.js");
      const result = analyzeTask(code);

      expect(result.artifacts.reads).toHaveLength(2);
      expect(result.artifacts.reads).toContainEqual({
        fileName: "research-output.json",
        stage: "validateStructure",
        required: true,
      });
      expect(result.artifacts.reads).toContainEqual({
        fileName: "research-output-2.json",
        stage: "finalValidation",
        required: true,
      });
    });

    it("extracts artifact writes", async () => {
      const code = await readTaskFile("research.js");
      const result = analyzeTask(code);

      expect(result.artifacts.writes).toHaveLength(4);
      expect(result.artifacts.writes).toContainEqual({
        fileName: "research-output.json",
        stage: "inference",
      });
      expect(result.artifacts.writes).toContainEqual({
        fileName: "research-revisedPrompt.txt",
        stage: "refine",
      });
      expect(result.artifacts.writes).toContainEqual({
        fileName: "research-output-2.json",
        stage: "refine",
      });
      expect(result.artifacts.writes).toContainEqual({
        fileName: "research-output.json",
        stage: "finalValidation",
      });
    });

    it("extracts LLM calls", async () => {
      const code = await readTaskFile("research.js");
      const result = analyzeTask(code);

      expect(result.models).toHaveLength(3);
      expect(result.models).toContainEqual({
        provider: "deepseek",
        method: "chat",
        stage: "inference",
      });
      expect(result.models).toContainEqual({
        provider: "anthropic",
        method: "sonnet45",
        stage: "critique",
      });
      expect(result.models).toContainEqual({
        provider: "deepseek",
        method: "chat",
        stage: "refine",
      });
    });
  });

  describe("synthesis.js", () => {
    it("extracts correct stages", async () => {
      const code = await readTaskFile("synthesis.js");
      const result = analyzeTask(code);

      expect(result.stages).toHaveLength(4);
      expect(result.stages.map((s) => s.name)).toEqual([
        "preProcessing",
        "promptTemplating",
        "inference",
        "validateStructure",
      ]);

      expect(result.stages[0].isAsync).toBe(true);
      expect(result.stages[2].isAsync).toBe(true);
      expect(result.stages[3].isAsync).toBe(true);
    });

    it("extracts artifact reads", async () => {
      const code = await readTaskFile("synthesis.js");
      const result = analyzeTask(code);

      expect(result.artifacts.reads).toHaveLength(3);
      expect(result.artifacts.reads).toContainEqual({
        fileName: "research-output.json",
        stage: "preProcessing",
        required: true,
      });
      expect(result.artifacts.reads).toContainEqual({
        fileName: "analysis-output.json",
        stage: "preProcessing",
        required: true,
      });
      expect(result.artifacts.reads).toContainEqual({
        fileName: "synthesis-output.json",
        stage: "validateStructure",
        required: true,
      });
    });

    it("extracts artifact writes", async () => {
      const code = await readTaskFile("synthesis.js");
      const result = analyzeTask(code);

      expect(result.artifacts.writes).toHaveLength(1);
      expect(result.artifacts.writes).toContainEqual({
        fileName: "synthesis-output.json",
        stage: "inference",
      });
    });

    it("extracts LLM calls", async () => {
      const code = await readTaskFile("synthesis.js");
      const result = analyzeTask(code);

      expect(result.models).toHaveLength(1);
      expect(result.models).toContainEqual({
        provider: "openai",
        method: "gpt5Mini",
        stage: "inference",
      });
    });
  });

  describe("output structure consistency", () => {
    it("returns consistent TaskAnalysis shape across all tasks", async () => {
      const analysisCode = await readTaskFile("analysis.js");
      const researchCode = await readTaskFile("research.js");
      const synthesisCode = await readTaskFile("synthesis.js");

      const analysisResult = analyzeTask(analysisCode);
      const researchResult = analyzeTask(researchCode);
      const synthesisResult = analyzeTask(synthesisCode);

      // Check top-level structure
      for (const result of [analysisResult, researchResult, synthesisResult]) {
        expect(result).toHaveProperty("stages");
        expect(result).toHaveProperty("artifacts");
        expect(result).toHaveProperty("models");
        expect(result.artifacts).toHaveProperty("reads");
        expect(result.artifacts).toHaveProperty("writes");
      }
    });
  });
});
