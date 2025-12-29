import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { handlePipelineAnalysis } from "../src/ui/endpoints/pipeline-analysis-endpoint.js";
import * as analysisLock from "../src/ui/lib/analysis-lock.js";
import * as config from "../src/core/config.js";
import * as taskAnalysis from "../src/task-analysis/index.js";
import * as analysisWriter from "../src/task-analysis/enrichers/analysis-writer.js";
import * as schemaDeducer from "../src/task-analysis/enrichers/schema-deducer.js";
import * as schemaWriter from "../src/task-analysis/enrichers/schema-writer.js";

describe("handlePipelineAnalysis", () => {
  let tempDir;
  let mockReq;
  let mockRes;
  let sseEvents;
  let resEnded;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pipeline-analysis-"));
    sseEvents = [];
    resEnded = false;

    mockReq = {
      params: { slug: "test-pipeline" },
      on: vi.fn(),
    };

    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      setHeader: vi.fn(),
      flushHeaders: vi.fn(),
      write: vi.fn((data) => {
        const lines = data.split("\n");
        let eventType = null;
        let eventData = null;

        for (const line of lines) {
          if (line.startsWith("event: ")) {
            eventType = line.substring(7).trim();
          } else if (line.startsWith("data: ")) {
            eventData = JSON.parse(line.substring(6));
          }
        }

        if (eventType && eventData) {
          sseEvents.push({ type: eventType, data: eventData });
        }
      }),
      end: vi.fn(() => {
        resEnded = true;
      }),
    };

    vi.spyOn(analysisLock, "acquireLock").mockImplementation(() => ({
      acquired: true,
    }));
    vi.spyOn(analysisLock, "releaseLock").mockImplementation(() => {});
    vi.spyOn(config, "getPipelineConfig");
    vi.spyOn(taskAnalysis, "analyzeTask");
    vi.spyOn(analysisWriter, "writeAnalysisFile");
    vi.spyOn(schemaDeducer, "deduceArtifactSchema");
    vi.spyOn(schemaWriter, "writeSchemaFiles");
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("returns 400 for invalid slug format", async () => {
    mockReq.params.slug = "invalid/slug";

    await handlePipelineAnalysis(mockReq, mockRes);

    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(mockRes.json).toHaveBeenCalledWith({
      ok: false,
      code: "invalid_slug",
      message: expect.stringContaining("Invalid slug format"),
    });
  });

  it("returns 400 for missing slug", async () => {
    mockReq.params.slug = "";

    await handlePipelineAnalysis(mockReq, mockRes);

    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(mockRes.json).toHaveBeenCalledWith({
      ok: false,
      code: "invalid_slug",
      message: expect.stringContaining("Missing or invalid slug"),
    });
  });

  it("returns 409 when lock already held", async () => {
    analysisLock.acquireLock.mockReturnValue({
      acquired: false,
      heldBy: "other-pipeline",
    });

    await handlePipelineAnalysis(mockReq, mockRes);

    expect(mockRes.status).toHaveBeenCalledWith(409);
    expect(mockRes.json).toHaveBeenCalledWith({
      ok: false,
      code: "analysis_locked",
      heldBy: "other-pipeline",
    });
  });

  it("sends started event with correct counts", async () => {
    const pipelineDir = await setupTestPipeline(tempDir, ["task1", "task2"]);

    analysisLock.acquireLock.mockReturnValue({ acquired: true });
    config.getPipelineConfig.mockReturnValue({
      pipelineJsonPath: path.join(pipelineDir, "pipeline.json"),
    });

    taskAnalysis.analyzeTask.mockReturnValue({
      taskFilePath: "tasks/task1.js",
      stages: [],
      artifacts: { reads: [], writes: [{ fileName: "output.json" }] },
      models: [],
    });

    analysisWriter.writeAnalysisFile.mockResolvedValue();
    schemaDeducer.deduceArtifactSchema.mockResolvedValue({
      schema: { type: "object" },
      example: {},
      reasoning: "test",
    });
    schemaWriter.writeSchemaFiles.mockResolvedValue();

    await handlePipelineAnalysis(mockReq, mockRes);

    const startedEvent = sseEvents.find((e) => e.type === "started");
    expect(startedEvent).toBeDefined();
    expect(startedEvent.data).toEqual({
      pipelineSlug: "test-pipeline",
      totalTasks: 2,
      totalArtifacts: 2,
    });
  });

  it("sends task:start and task:complete for each task", async () => {
    const pipelineDir = await setupTestPipeline(tempDir, ["task1", "task2"]);

    analysisLock.acquireLock.mockReturnValue({ acquired: true });
    config.getPipelineConfig.mockReturnValue({
      pipelineJsonPath: path.join(pipelineDir, "pipeline.json"),
    });

    taskAnalysis.analyzeTask.mockReturnValue({
      taskFilePath: "tasks/task1.js",
      stages: [],
      artifacts: { reads: [], writes: [] },
      models: [],
    });

    analysisWriter.writeAnalysisFile.mockResolvedValue();

    await handlePipelineAnalysis(mockReq, mockRes);

    const taskStartEvents = sseEvents.filter((e) => e.type === "task:start");
    const taskCompleteEvents = sseEvents.filter(
      (e) => e.type === "task:complete"
    );

    expect(taskStartEvents).toHaveLength(2);
    expect(taskCompleteEvents).toHaveLength(2);

    expect(taskStartEvents[0].data).toEqual({
      taskId: "task1",
      taskIndex: 0,
      totalTasks: 2,
    });

    expect(taskCompleteEvents[0].data).toEqual({
      taskId: "task1",
      taskIndex: 0,
      totalTasks: 2,
    });
  });

  it("sends artifact:start and artifact:complete for each artifact", async () => {
    const pipelineDir = await setupTestPipeline(tempDir, ["task1"]);

    analysisLock.acquireLock.mockReturnValue({ acquired: true });
    config.getPipelineConfig.mockReturnValue({
      pipelineJsonPath: path.join(pipelineDir, "pipeline.json"),
    });

    taskAnalysis.analyzeTask.mockReturnValue({
      taskFilePath: "tasks/task1.js",
      stages: [],
      artifacts: {
        reads: [],
        writes: [
          { fileName: "output1.json", stage: "ingestion" },
          { fileName: "output2.json", stage: "ingestion" },
        ],
      },
      models: [],
    });

    analysisWriter.writeAnalysisFile.mockResolvedValue();
    schemaDeducer.deduceArtifactSchema.mockResolvedValue({
      schema: { type: "object" },
      example: {},
      reasoning: "test",
    });
    schemaWriter.writeSchemaFiles.mockResolvedValue();

    await handlePipelineAnalysis(mockReq, mockRes);

    const artifactStartEvents = sseEvents.filter(
      (e) => e.type === "artifact:start"
    );
    const artifactCompleteEvents = sseEvents.filter(
      (e) => e.type === "artifact:complete"
    );

    expect(artifactStartEvents).toHaveLength(2);
    expect(artifactCompleteEvents).toHaveLength(2);

    expect(artifactStartEvents[0].data).toEqual({
      taskId: "task1",
      artifactName: "output1.json",
      artifactIndex: 0,
      totalArtifacts: 2,
    });

    expect(artifactCompleteEvents[1].data).toEqual({
      taskId: "task1",
      artifactName: "output2.json",
      artifactIndex: 1,
      totalArtifacts: 2,
    });
  });

  it("sends complete event on success", async () => {
    const pipelineDir = await setupTestPipeline(tempDir, ["task1"]);

    analysisLock.acquireLock.mockReturnValue({ acquired: true });
    config.getPipelineConfig.mockReturnValue({
      pipelineJsonPath: path.join(pipelineDir, "pipeline.json"),
    });

    taskAnalysis.analyzeTask.mockReturnValue({
      taskFilePath: "tasks/task1.js",
      stages: [],
      artifacts: { reads: [], writes: [{ fileName: "output.json" }] },
      models: [],
    });

    analysisWriter.writeAnalysisFile.mockResolvedValue();
    schemaDeducer.deduceArtifactSchema.mockResolvedValue({
      schema: { type: "object" },
      example: {},
      reasoning: "test",
    });
    schemaWriter.writeSchemaFiles.mockResolvedValue();

    await handlePipelineAnalysis(mockReq, mockRes);

    const completeEvent = sseEvents.find((e) => e.type === "complete");
    expect(completeEvent).toBeDefined();
    expect(completeEvent.data).toEqual({
      pipelineSlug: "test-pipeline",
      tasksAnalyzed: 1,
      artifactsProcessed: 1,
      durationMs: expect.any(Number),
    });

    expect(resEnded).toBe(true);
  });

  it("releases lock after completion", async () => {
    const pipelineDir = await setupTestPipeline(tempDir, ["task1"]);

    analysisLock.acquireLock.mockReturnValue({ acquired: true });
    config.getPipelineConfig.mockReturnValue({
      pipelineJsonPath: path.join(pipelineDir, "pipeline.json"),
    });

    taskAnalysis.analyzeTask.mockReturnValue({
      taskFilePath: "tasks/task1.js",
      stages: [],
      artifacts: { reads: [], writes: [] },
      models: [],
    });

    analysisWriter.writeAnalysisFile.mockResolvedValue();

    await handlePipelineAnalysis(mockReq, mockRes);

    expect(analysisLock.releaseLock).toHaveBeenCalledWith("test-pipeline");
  });

  it("releases lock on error", async () => {
    analysisLock.acquireLock.mockReturnValue({ acquired: true });
    config.getPipelineConfig.mockImplementation(() => {
      throw new Error("Pipeline not found");
    });

    await handlePipelineAnalysis(mockReq, mockRes);

    expect(analysisLock.releaseLock).toHaveBeenCalledWith("test-pipeline");
    expect(resEnded).toBe(true);
  });

  it("sends error event on analysis failure", async () => {
    const pipelineDir = await setupTestPipeline(tempDir, ["task1"]);

    analysisLock.acquireLock.mockReturnValue({ acquired: true });
    config.getPipelineConfig.mockReturnValue({
      pipelineJsonPath: path.join(pipelineDir, "pipeline.json"),
    });

    taskAnalysis.analyzeTask.mockImplementation(() => {
      throw new Error("Failed to parse task");
    });

    await handlePipelineAnalysis(mockReq, mockRes);

    const errorEvent = sseEvents.find((e) => e.type === "error");
    expect(errorEvent).toBeDefined();
    expect(errorEvent.data.message).toContain("Failed to analyze task");
    expect(errorEvent.data.taskId).toBe("task1");

    expect(analysisLock.releaseLock).toHaveBeenCalledWith("test-pipeline");
    expect(resEnded).toBe(true);
  });

  it("releases lock on client disconnect", async () => {
    const pipelineDir = await setupTestPipeline(tempDir, ["task1"]);
    let disconnectHandler;

    mockReq.on.mockImplementation((event, handler) => {
      if (event === "close") {
        disconnectHandler = handler;
      }
    });

    analysisLock.acquireLock.mockReturnValue({ acquired: true });
    config.getPipelineConfig.mockReturnValue({
      pipelineJsonPath: path.join(pipelineDir, "pipeline.json"),
    });

    taskAnalysis.analyzeTask.mockReturnValue({
      taskFilePath: "tasks/task1.js",
      stages: [],
      artifacts: { reads: [], writes: [] },
      models: [],
    });

    analysisWriter.writeAnalysisFile.mockResolvedValue();

    const analysisPromise = handlePipelineAnalysis(mockReq, mockRes);

    // Simulate client disconnect
    if (disconnectHandler) {
      disconnectHandler();
    }

    await analysisPromise;

    expect(analysisLock.releaseLock).toHaveBeenCalledWith("test-pipeline");
  });

  it("sends error event when pipeline not found", async () => {
    analysisLock.acquireLock.mockReturnValue({ acquired: true });
    config.getPipelineConfig.mockImplementation(() => {
      throw new Error("Pipeline not found in registry");
    });

    await handlePipelineAnalysis(mockReq, mockRes);

    const errorEvent = sseEvents.find((e) => e.type === "error");
    expect(errorEvent).toBeDefined();
    expect(errorEvent.data.message).toContain("not found in registry");
  });

  it("sends error event when pipeline.json is invalid", async () => {
    const pipelineDir = tempDir;
    const pipelineJsonPath = path.join(pipelineDir, "pipeline.json");
    await fs.writeFile(pipelineJsonPath, "{ invalid json }");

    analysisLock.acquireLock.mockReturnValue({ acquired: true });
    config.getPipelineConfig.mockReturnValue({ pipelineJsonPath });

    await handlePipelineAnalysis(mockReq, mockRes);

    const errorEvent = sseEvents.find((e) => e.type === "error");
    expect(errorEvent).toBeDefined();
    expect(errorEvent.data.message).toContain("Failed to read pipeline.json");
  });

  it("skips non-JSON artifacts during schema deduction", async () => {
    const pipelineDir = await setupTestPipeline(tempDir, ["task1"]);

    analysisLock.acquireLock.mockReturnValue({ acquired: true });
    config.getPipelineConfig.mockReturnValue({
      pipelineJsonPath: path.join(pipelineDir, "pipeline.json"),
    });

    taskAnalysis.analyzeTask.mockReturnValue({
      taskFilePath: "tasks/task1.js",
      stages: [],
      artifacts: {
        reads: [],
        writes: [
          { fileName: "output.json", stage: "ingestion" },
          { fileName: "prompt.txt", stage: "ingestion" },
          { fileName: "data.json", stage: "processing" },
        ],
      },
      models: [],
    });

    analysisWriter.writeAnalysisFile.mockResolvedValue();
    schemaDeducer.deduceArtifactSchema.mockResolvedValue({
      schema: { type: "object" },
      example: {},
      reasoning: "test",
    });
    schemaWriter.writeSchemaFiles.mockResolvedValue();

    await handlePipelineAnalysis(mockReq, mockRes);

    // Should only process JSON files
    expect(schemaDeducer.deduceArtifactSchema).toHaveBeenCalledTimes(2);
    expect(schemaDeducer.deduceArtifactSchema).toHaveBeenCalledWith(
      expect.anything(),
      { fileName: "output.json", stage: "ingestion" }
    );
    expect(schemaDeducer.deduceArtifactSchema).toHaveBeenCalledWith(
      expect.anything(),
      { fileName: "data.json", stage: "processing" }
    );

    // Should not call schema deduction for .txt file
    expect(schemaDeducer.deduceArtifactSchema).not.toHaveBeenCalledWith(
      expect.anything(),
      { fileName: "prompt.txt", stage: "ingestion" }
    );

    // Total artifacts should only count JSON files
    const startedEvent = sseEvents.find((e) => e.type === "started");
    expect(startedEvent.data.totalArtifacts).toBe(2);

    // Should only send artifact events for JSON files
    const artifactStartEvents = sseEvents.filter(
      (e) => e.type === "artifact:start"
    );
    const artifactCompleteEvents = sseEvents.filter(
      (e) => e.type === "artifact:complete"
    );
    expect(artifactStartEvents).toHaveLength(2);
    expect(artifactCompleteEvents).toHaveLength(2);

    // Verify .txt file is not in artifact events
    const artifactNames = artifactStartEvents.map((e) => e.data.artifactName);
    expect(artifactNames).toContain("output.json");
    expect(artifactNames).toContain("data.json");
    expect(artifactNames).not.toContain("prompt.txt");
  });
});

/**
 * Helper to set up a test pipeline directory structure
 */
async function setupTestPipeline(baseDir, taskNames) {
  const pipelineDir = baseDir;
  const tasksDir = path.join(pipelineDir, "tasks");

  await fs.mkdir(tasksDir, { recursive: true });

  // Write pipeline.json
  await fs.writeFile(
    path.join(pipelineDir, "pipeline.json"),
    JSON.stringify({ tasks: taskNames })
  );

  // Write task files
  for (const taskName of taskNames) {
    await fs.writeFile(
      path.join(tasksDir, `${taskName}.js`),
      `export function ingestion() { /* stub */ }`
    );
  }

  return pipelineDir;
}
