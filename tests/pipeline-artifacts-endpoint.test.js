import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

// Import will fail until we create the endpoint - that's expected for TDD
import { handlePipelineArtifacts } from "../src/ui/endpoints/pipeline-artifacts-endpoint.js";
import * as config from "../src/core/config.js";

describe("handlePipelineArtifacts", () => {
  let tempDir;
  let mockReq;
  let mockRes;
  let jsonResponse;
  let statusCode;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pipeline-artifacts-"));
    jsonResponse = null;
    statusCode = null;

    mockReq = {
      params: { slug: "test-pipeline" },
    };

    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn((data) => {
        jsonResponse = data;
        return mockRes;
      }),
      setHeader: vi.fn(),
    };

    // Capture status code from status() call
    mockRes.status.mockImplementation((code) => {
      statusCode = code;
      return mockRes;
    });

    vi.spyOn(config, "getPipelineConfig");
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("returns 400 for invalid slug format", async () => {
    mockReq.params.slug = "invalid/slug";

    await handlePipelineArtifacts(mockReq, mockRes);

    expect(statusCode).toBe(400);
    expect(jsonResponse).toEqual({
      ok: false,
      code: "bad_request",
      message: expect.stringContaining("Invalid slug"),
    });
  });

  it("returns 400 for missing slug", async () => {
    mockReq.params.slug = "";

    await handlePipelineArtifacts(mockReq, mockRes);

    expect(statusCode).toBe(400);
    expect(jsonResponse).toEqual({
      ok: false,
      code: "bad_request",
      message: expect.stringContaining("Invalid slug"),
    });
  });

  it("returns 404 when pipeline not found", async () => {
    config.getPipelineConfig.mockImplementation(() => {
      throw new Error("Pipeline not found");
    });

    await handlePipelineArtifacts(mockReq, mockRes);

    expect(statusCode).toBe(404);
    expect(jsonResponse).toEqual({
      ok: false,
      code: "not_found",
      message: expect.stringContaining("not found"),
    });
  });

  it("returns empty artifacts array when analysis directory is missing", async () => {
    const pipelineDir = tempDir;

    config.getPipelineConfig.mockReturnValue({
      pipelineJsonPath: path.join(pipelineDir, "pipeline.json"),
    });

    // Create pipeline.json but no analysis directory
    await fs.writeFile(
      path.join(pipelineDir, "pipeline.json"),
      JSON.stringify({ tasks: ["task1"] })
    );

    await handlePipelineArtifacts(mockReq, mockRes);

    expect(statusCode).toBe(200);
    expect(jsonResponse).toEqual({
      ok: true,
      artifacts: [],
    });
  });

  it("returns aggregated artifacts from analysis files", async () => {
    const pipelineDir = tempDir;
    const analysisDir = path.join(pipelineDir, "analysis");
    await fs.mkdir(analysisDir, { recursive: true });

    config.getPipelineConfig.mockReturnValue({
      pipelineJsonPath: path.join(pipelineDir, "pipeline.json"),
    });

    // Create pipeline.json
    await fs.writeFile(
      path.join(pipelineDir, "pipeline.json"),
      JSON.stringify({ tasks: ["task1", "task2"] })
    );

    // Create analysis files with artifact writes
    await fs.writeFile(
      path.join(analysisDir, "task1.analysis.json"),
      JSON.stringify({
        taskId: "task1",
        artifacts: {
          reads: [],
          writes: [
            { fileName: "output1.json", stage: "ingestion" },
            { fileName: "output2.json", stage: "processing" },
          ],
        },
      })
    );

    await fs.writeFile(
      path.join(analysisDir, "task2.analysis.json"),
      JSON.stringify({
        taskId: "task2",
        artifacts: {
          reads: [],
          writes: [{ fileName: "output3.json", stage: "ingestion" }],
        },
      })
    );

    await handlePipelineArtifacts(mockReq, mockRes);

    expect(statusCode).toBe(200);
    expect(jsonResponse.ok).toBe(true);
    expect(jsonResponse.artifacts).toHaveLength(3);
    expect(jsonResponse.artifacts).toContainEqual({
      fileName: "output1.json",
      sources: [{ taskName: "task1", stage: "ingestion" }],
    });
    expect(jsonResponse.artifacts).toContainEqual({
      fileName: "output2.json",
      sources: [{ taskName: "task1", stage: "processing" }],
    });
    expect(jsonResponse.artifacts).toContainEqual({
      fileName: "output3.json",
      sources: [{ taskName: "task2", stage: "ingestion" }],
    });
  });

  it("de-duplicates artifacts appearing in multiple tasks", async () => {
    const pipelineDir = tempDir;
    const analysisDir = path.join(pipelineDir, "analysis");
    await fs.mkdir(analysisDir, { recursive: true });

    config.getPipelineConfig.mockReturnValue({
      pipelineJsonPath: path.join(pipelineDir, "pipeline.json"),
    });

    await fs.writeFile(
      path.join(pipelineDir, "pipeline.json"),
      JSON.stringify({ tasks: ["task1", "task2"] })
    );

    // Both tasks write to the same file
    await fs.writeFile(
      path.join(analysisDir, "task1.analysis.json"),
      JSON.stringify({
        taskId: "task1",
        artifacts: {
          reads: [],
          writes: [{ fileName: "shared-output.json", stage: "ingestion" }],
        },
      })
    );

    await fs.writeFile(
      path.join(analysisDir, "task2.analysis.json"),
      JSON.stringify({
        taskId: "task2",
        artifacts: {
          reads: [],
          writes: [{ fileName: "shared-output.json", stage: "processing" }],
        },
      })
    );

    await handlePipelineArtifacts(mockReq, mockRes);

    expect(statusCode).toBe(200);
    expect(jsonResponse.ok).toBe(true);
    // Should have one artifact with multiple sources
    expect(jsonResponse.artifacts).toHaveLength(1);
    expect(jsonResponse.artifacts[0]).toEqual({
      fileName: "shared-output.json",
      sources: [
        { taskName: "task1", stage: "ingestion" },
        { taskName: "task2", stage: "processing" },
      ],
    });
  });

  it("ignores non-analysis JSON files in analysis directory", async () => {
    const pipelineDir = tempDir;
    const analysisDir = path.join(pipelineDir, "analysis");
    await fs.mkdir(analysisDir, { recursive: true });

    config.getPipelineConfig.mockReturnValue({
      pipelineJsonPath: path.join(pipelineDir, "pipeline.json"),
    });

    await fs.writeFile(
      path.join(pipelineDir, "pipeline.json"),
      JSON.stringify({ tasks: ["task1"] })
    );

    // Create valid analysis file
    await fs.writeFile(
      path.join(analysisDir, "task1.analysis.json"),
      JSON.stringify({
        taskId: "task1",
        artifacts: {
          reads: [],
          writes: [{ fileName: "output.json", stage: "ingestion" }],
        },
      })
    );

    // Create non-analysis file that should be ignored
    await fs.writeFile(
      path.join(analysisDir, "config.json"),
      JSON.stringify({ shouldBeIgnored: true })
    );

    await handlePipelineArtifacts(mockReq, mockRes);

    expect(statusCode).toBe(200);
    expect(jsonResponse.artifacts).toHaveLength(1);
    expect(jsonResponse.artifacts[0].fileName).toBe("output.json");
  });

  it("handles analysis files with missing artifacts gracefully", async () => {
    const pipelineDir = tempDir;
    const analysisDir = path.join(pipelineDir, "analysis");
    await fs.mkdir(analysisDir, { recursive: true });

    config.getPipelineConfig.mockReturnValue({
      pipelineJsonPath: path.join(pipelineDir, "pipeline.json"),
    });

    await fs.writeFile(
      path.join(pipelineDir, "pipeline.json"),
      JSON.stringify({ tasks: ["task1"] })
    );

    // Create analysis file without artifacts.writes
    await fs.writeFile(
      path.join(analysisDir, "task1.analysis.json"),
      JSON.stringify({
        taskId: "task1",
        artifacts: { reads: [] },
      })
    );

    await handlePipelineArtifacts(mockReq, mockRes);

    expect(statusCode).toBe(200);
    expect(jsonResponse.ok).toBe(true);
    expect(jsonResponse.artifacts).toEqual([]);
  });

  it("handles malformed analysis files gracefully", async () => {
    const pipelineDir = tempDir;
    const analysisDir = path.join(pipelineDir, "analysis");
    await fs.mkdir(analysisDir, { recursive: true });

    config.getPipelineConfig.mockReturnValue({
      pipelineJsonPath: path.join(pipelineDir, "pipeline.json"),
    });

    await fs.writeFile(
      path.join(pipelineDir, "pipeline.json"),
      JSON.stringify({ tasks: ["task1", "task2"] })
    );

    // Create valid analysis file
    await fs.writeFile(
      path.join(analysisDir, "task1.analysis.json"),
      JSON.stringify({
        taskId: "task1",
        artifacts: {
          reads: [],
          writes: [{ fileName: "output.json", stage: "ingestion" }],
        },
      })
    );

    // Create malformed analysis file
    await fs.writeFile(
      path.join(analysisDir, "task2.analysis.json"),
      "{ invalid json }"
    );

    await handlePipelineArtifacts(mockReq, mockRes);

    // Should still return valid artifacts from task1
    expect(statusCode).toBe(200);
    expect(jsonResponse.ok).toBe(true);
    expect(jsonResponse.artifacts).toHaveLength(1);
  });
});
