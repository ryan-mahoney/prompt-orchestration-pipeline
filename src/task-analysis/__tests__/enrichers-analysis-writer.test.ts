import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { writeAnalysisFile } from "../enrichers/analysis-writer.ts";
import type { TaskAnalysis } from "../types.ts";

const VALID_ANALYSIS: TaskAnalysis = {
  taskFilePath: "/pipeline/tasks/research.js",
  stages: [{ name: "fetchData", order: 0, isAsync: true }],
  artifacts: {
    reads: [{ fileName: "input.json", stage: "fetchData", required: true }],
    writes: [{ fileName: "output.json", stage: "fetchData" }],
    unresolvedReads: [],
    unresolvedWrites: [],
  },
  models: [{ provider: "openai", method: "chat", stage: "fetchData" }],
};

let tmpDir: string;

beforeAll(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), "analysis-writer-test-"));
});

afterAll(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("writeAnalysisFile", () => {
  it("writes analysis file with analyzedAt and all fields for valid input", async () => {
    const pipelinePath = path.join(tmpDir, "pipeline-1");
    const before = new Date();

    await writeAnalysisFile(pipelinePath, "research", VALID_ANALYSIS);

    const after = new Date();
    const filePath = path.join(pipelinePath, "analysis", "research.analysis.json");
    expect(existsSync(filePath)).toBe(true);

    const content = JSON.parse(await Bun.file(filePath).text()) as Record<string, unknown>;

    expect(typeof content.analyzedAt).toBe("string");
    const analyzedAt = new Date(content.analyzedAt as string);
    expect(analyzedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(analyzedAt.getTime()).toBeLessThanOrEqual(after.getTime());

    expect(content.taskFilePath).toBe(VALID_ANALYSIS.taskFilePath);
    expect(content.stages).toEqual(VALID_ANALYSIS.stages);
    expect(content.artifacts).toEqual(VALID_ANALYSIS.artifacts);
    expect(content.models).toEqual(VALID_ANALYSIS.models);
  });

  it("throws before creating any file when taskFilePath is null", async () => {
    const pipelinePath = path.join(tmpDir, "pipeline-2");
    const bad = { ...VALID_ANALYSIS, taskFilePath: null } as unknown as TaskAnalysis;

    await expect(
      writeAnalysisFile(pipelinePath, "research", bad),
    ).rejects.toThrow(/taskFilePath/);

    expect(existsSync(path.join(pipelinePath, "analysis"))).toBe(false);
  });

  it("throws when stages is not an array", async () => {
    const pipelinePath = path.join(tmpDir, "pipeline-3");
    const bad = { ...VALID_ANALYSIS, stages: "not-an-array" } as unknown as TaskAnalysis;

    await expect(
      writeAnalysisFile(pipelinePath, "research", bad),
    ).rejects.toThrow(/stages/);
  });

  it("throws when artifacts is missing reads", async () => {
    const pipelinePath = path.join(tmpDir, "pipeline-4");
    const bad = {
      ...VALID_ANALYSIS,
      artifacts: { writes: [], unresolvedReads: [], unresolvedWrites: [] },
    } as unknown as TaskAnalysis;

    await expect(
      writeAnalysisFile(pipelinePath, "research", bad),
    ).rejects.toThrow(/artifacts/);
  });
});
