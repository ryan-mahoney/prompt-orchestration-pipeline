import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { handleTaskAnalysisRequest } from "../src/ui/endpoints/task-analysis-endpoint.js";
import * as config from "../src/core/config.js";

describe("handleTaskAnalysisRequest", () => {
  let tempDir;
  let mockReq;
  let mockRes;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "task-analysis-"));

    mockReq = {
      params: { slug: "test-pipeline", taskId: "test-task" },
    };

    mockRes = {
      writeHead: vi.fn(),
      end: vi.fn(),
    };

    vi.spyOn(config, "getPipelineConfig");
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("returns 400 for invalid slug with special characters", async () => {
    mockReq.params.slug = "invalid/slug";

    await handleTaskAnalysisRequest(mockReq, mockRes);

    expect(mockRes.writeHead).toHaveBeenCalledWith(400, {
      "content-type": "application/json",
      connection: "close",
    });
    expect(mockRes.end).toHaveBeenCalledWith(
      JSON.stringify({
        ok: false,
        code: "invalid_params",
        message: "Invalid slug parameter",
      })
    );
  });

  it("returns 400 for invalid slug with spaces", async () => {
    mockReq.params.slug = "invalid slug";

    await handleTaskAnalysisRequest(mockReq, mockRes);

    expect(mockRes.writeHead).toHaveBeenCalledWith(400, {
      "content-type": "application/json",
      connection: "close",
    });
    expect(mockRes.end).toHaveBeenCalledWith(
      JSON.stringify({
        ok: false,
        code: "invalid_params",
        message: "Invalid slug parameter",
      })
    );
  });

  it("returns 400 for empty slug", async () => {
    mockReq.params.slug = "";

    await handleTaskAnalysisRequest(mockReq, mockRes);

    expect(mockRes.writeHead).toHaveBeenCalledWith(400, {
      "content-type": "application/json",
      connection: "close",
    });
    expect(mockRes.end).toHaveBeenCalledWith(
      JSON.stringify({
        ok: false,
        code: "invalid_params",
        message: "Invalid slug parameter",
      })
    );
  });

  it("returns 400 for invalid taskId with special characters", async () => {
    mockReq.params.taskId = "invalid@task";

    await handleTaskAnalysisRequest(mockReq, mockRes);

    expect(mockRes.writeHead).toHaveBeenCalledWith(400, {
      "content-type": "application/json",
      connection: "close",
    });
    expect(mockRes.end).toHaveBeenCalledWith(
      JSON.stringify({
        ok: false,
        code: "invalid_params",
        message: "Invalid taskId parameter",
      })
    );
  });

  it("returns 400 for invalid taskId with dots", async () => {
    mockReq.params.taskId = "invalid.task";

    await handleTaskAnalysisRequest(mockReq, mockRes);

    expect(mockRes.writeHead).toHaveBeenCalledWith(400, {
      "content-type": "application/json",
      connection: "close",
    });
    expect(mockRes.end).toHaveBeenCalledWith(
      JSON.stringify({
        ok: false,
        code: "invalid_params",
        message: "Invalid taskId parameter",
      })
    );
  });

  it("returns 400 for empty taskId", async () => {
    mockReq.params.taskId = "";

    await handleTaskAnalysisRequest(mockReq, mockRes);

    expect(mockRes.writeHead).toHaveBeenCalledWith(400, {
      "content-type": "application/json",
      connection: "close",
    });
    expect(mockRes.end).toHaveBeenCalledWith(
      JSON.stringify({
        ok: false,
        code: "invalid_params",
        message: "Invalid taskId parameter",
      })
    );
  });

  it("returns 404 for non-existent pipeline", async () => {
    config.getPipelineConfig.mockImplementation(() => {
      throw new Error("Pipeline not found in registry");
    });

    await handleTaskAnalysisRequest(mockReq, mockRes);

    expect(mockRes.writeHead).toHaveBeenCalledWith(404, {
      "content-type": "application/json",
      connection: "close",
    });
    expect(mockRes.end).toHaveBeenCalledWith(
      JSON.stringify({
        ok: false,
        code: "not_found",
        message: "Pipeline 'test-pipeline' not found in registry",
      })
    );
  });

  it("returns { ok: true, data: null } when analysis file missing", async () => {
    const pipelineDir = tempDir;
    const pipelineJsonPath = path.join(pipelineDir, "pipeline.json");

    config.getPipelineConfig.mockReturnValue({ pipelineJsonPath });

    await handleTaskAnalysisRequest(mockReq, mockRes);

    expect(mockRes.writeHead).toHaveBeenCalledWith(200, {
      "content-type": "application/json",
      connection: "close",
    });
    expect(mockRes.end).toHaveBeenCalledWith(
      JSON.stringify({
        ok: true,
        data: null,
      })
    );
  });

  it("returns { ok: true, data: {...} } with valid analysis data when file exists", async () => {
    const pipelineDir = tempDir;
    const pipelineJsonPath = path.join(pipelineDir, "pipeline.json");
    const analysisDir = path.join(pipelineDir, "analysis");
    const analysisPath = path.join(analysisDir, "test-task.analysis.json");

    const analysisData = {
      taskFilePath: "tasks/test-task.js",
      stages: [
        { name: "ingestion", order: 0, isAsync: false },
        { name: "processing", order: 1, isAsync: true },
      ],
      artifacts: {
        reads: [{ fileName: "input.json", stage: "ingestion", required: true }],
        writes: [{ fileName: "output.json", stage: "processing" }],
      },
      models: [{ provider: "openai", method: "chat", stage: "processing" }],
      analyzedAt: "2025-12-29T12:00:00.000Z",
    };

    await fs.mkdir(analysisDir, { recursive: true });
    await fs.writeFile(analysisPath, JSON.stringify(analysisData, null, 2));

    config.getPipelineConfig.mockReturnValue({ pipelineJsonPath });

    await handleTaskAnalysisRequest(mockReq, mockRes);

    expect(mockRes.writeHead).toHaveBeenCalledWith(200, {
      "content-type": "application/json",
      connection: "close",
    });
    expect(mockRes.end).toHaveBeenCalledWith(
      JSON.stringify({
        ok: true,
        data: analysisData,
      })
    );
  });

  it("returns 500 for invalid JSON in analysis file", async () => {
    const pipelineDir = tempDir;
    const pipelineJsonPath = path.join(pipelineDir, "pipeline.json");
    const analysisDir = path.join(pipelineDir, "analysis");
    const analysisPath = path.join(analysisDir, "test-task.analysis.json");

    await fs.mkdir(analysisDir, { recursive: true });
    await fs.writeFile(analysisPath, "{ invalid json }");

    config.getPipelineConfig.mockReturnValue({ pipelineJsonPath });

    await handleTaskAnalysisRequest(mockReq, mockRes);

    expect(mockRes.writeHead).toHaveBeenCalledWith(500, {
      "content-type": "application/json",
      connection: "close",
    });
    expect(mockRes.end).toHaveBeenCalledWith(
      JSON.stringify({
        ok: false,
        code: "invalid_json",
        message: "Invalid JSON in analysis file",
      })
    );
  });

  it("accepts valid slug with hyphens and underscores", async () => {
    const pipelineDir = tempDir;
    const pipelineJsonPath = path.join(pipelineDir, "pipeline.json");

    mockReq.params.slug = "valid-slug_123";
    config.getPipelineConfig.mockReturnValue({ pipelineJsonPath });

    await handleTaskAnalysisRequest(mockReq, mockRes);

    expect(mockRes.writeHead).toHaveBeenCalledWith(200, {
      "content-type": "application/json",
      connection: "close",
    });
    expect(mockRes.end).toHaveBeenCalledWith(
      JSON.stringify({
        ok: true,
        data: null,
      })
    );
  });

  it("accepts valid taskId with hyphens and underscores", async () => {
    const pipelineDir = tempDir;
    const pipelineJsonPath = path.join(pipelineDir, "pipeline.json");

    mockReq.params.taskId = "valid-task_123";
    config.getPipelineConfig.mockReturnValue({ pipelineJsonPath });

    await handleTaskAnalysisRequest(mockReq, mockRes);

    expect(mockRes.writeHead).toHaveBeenCalledWith(200, {
      "content-type": "application/json",
      connection: "close",
    });
    expect(mockRes.end).toHaveBeenCalledWith(
      JSON.stringify({
        ok: true,
        data: null,
      })
    );
  });

  it("returns 500 for unexpected errors", async () => {
    config.getPipelineConfig.mockReturnValue({ pipelineJsonPath: "/path" });

    // Mock fs.readFile to throw unexpected error
    const originalReadFile = fs.readFile;
    fs.readFile = vi.fn().mockRejectedValue(new Error("Unexpected error"));

    await handleTaskAnalysisRequest(mockReq, mockRes);

    expect(mockRes.writeHead).toHaveBeenCalledWith(500, {
      "content-type": "application/json",
      connection: "close",
    });
    expect(mockRes.end).toHaveBeenCalledWith(
      JSON.stringify({
        ok: false,
        code: "internal_error",
        message: "Internal server error",
      })
    );

    fs.readFile = originalReadFile;
  });
});
