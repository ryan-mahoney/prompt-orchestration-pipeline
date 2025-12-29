import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { handleSchemaFileRequest } from "../src/ui/endpoints/schema-file-endpoint.js";
import * as config from "../src/core/config.js";

describe("handleSchemaFileRequest", () => {
  let tempDir;
  let mockReq;
  let mockRes;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "schema-file-"));

    mockReq = {
      params: { slug: "test-pipeline", fileName: "test.json" },
      query: { type: "schema" },
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

    await handleSchemaFileRequest(mockReq, mockRes);

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

  it("returns 400 for invalid fileName with path traversal attempt", async () => {
    mockReq.params.fileName = "../etc/passwd";

    await handleSchemaFileRequest(mockReq, mockRes);

    expect(mockRes.writeHead).toHaveBeenCalledWith(400, {
      "content-type": "application/json",
      connection: "close",
    });
    expect(mockRes.end).toHaveBeenCalledWith(
      JSON.stringify({
        ok: false,
        code: "invalid_params",
        message: "Invalid fileName parameter",
      })
    );
  });

  it("returns 400 for invalid fileName with slash", async () => {
    mockReq.params.fileName = "path/to/file.json";

    await handleSchemaFileRequest(mockReq, mockRes);

    expect(mockRes.writeHead).toHaveBeenCalledWith(400, {
      "content-type": "application/json",
      connection: "close",
    });
    expect(mockRes.end).toHaveBeenCalledWith(
      JSON.stringify({
        ok: false,
        code: "invalid_params",
        message: "Invalid fileName parameter",
      })
    );
  });

  it("returns 400 for invalid type parameter", async () => {
    mockReq.query.type = "invalid";

    await handleSchemaFileRequest(mockReq, mockRes);

    expect(mockRes.writeHead).toHaveBeenCalledWith(400, {
      "content-type": "application/json",
      connection: "close",
    });
    expect(mockRes.end).toHaveBeenCalledWith(
      JSON.stringify({
        ok: false,
        code: "invalid_params",
        message: "Invalid type parameter - must be 'schema' or 'sample'",
      })
    );
  });

  it("returns 400 when type is missing", async () => {
    mockReq.query.type = undefined;

    await handleSchemaFileRequest(mockReq, mockRes);

    expect(mockRes.writeHead).toHaveBeenCalledWith(400, {
      "content-type": "application/json",
      connection: "close",
    });
    expect(mockRes.end).toHaveBeenCalledWith(
      JSON.stringify({
        ok: false,
        code: "invalid_params",
        message: "Invalid type parameter - must be 'schema' or 'sample'",
      })
    );
  });

  it("returns 404 when pipeline not found in registry", async () => {
    config.getPipelineConfig.mockImplementation(() => {
      throw new Error("Pipeline not found in registry");
    });

    await handleSchemaFileRequest(mockReq, mockRes);

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

  it("returns 404 when schema file doesn't exist", async () => {
    const pipelineDir = tempDir;
    const pipelineJsonPath = path.join(pipelineDir, "pipeline.json");

    config.getPipelineConfig.mockReturnValue({ pipelineJsonPath });

    await handleSchemaFileRequest(mockReq, mockRes);

    expect(mockRes.writeHead).toHaveBeenCalledWith(404, {
      "content-type": "application/json",
      connection: "close",
    });
    expect(mockRes.end).toHaveBeenCalledWith(
      JSON.stringify({
        ok: false,
        code: "not_found",
        message: "Schema file not found",
      })
    );
  });

  it("returns 200 with file contents for valid schema request", async () => {
    const pipelineDir = tempDir;
    const pipelineJsonPath = path.join(pipelineDir, "pipeline.json");
    const schemasDir = path.join(pipelineDir, "schemas");
    const schemaPath = path.join(schemasDir, "test.schema.json");

    const schemaContent = JSON.stringify({
      type: "object",
      properties: { name: { type: "string" } },
    });

    await fs.mkdir(schemasDir, { recursive: true });
    await fs.writeFile(schemaPath, schemaContent);

    config.getPipelineConfig.mockReturnValue({ pipelineJsonPath });

    await handleSchemaFileRequest(mockReq, mockRes);

    expect(mockRes.writeHead).toHaveBeenCalledWith(200, {
      "content-type": "application/json",
      connection: "close",
    });
    expect(mockRes.end).toHaveBeenCalledWith(
      JSON.stringify({
        ok: true,
        data: schemaContent,
      })
    );
  });

  it("returns 200 with file contents for valid sample request", async () => {
    const pipelineDir = tempDir;
    const pipelineJsonPath = path.join(pipelineDir, "pipeline.json");
    const schemasDir = path.join(pipelineDir, "schemas");
    const samplePath = path.join(schemasDir, "test.sample.json");

    const sampleContent = JSON.stringify({ name: "example" });

    await fs.mkdir(schemasDir, { recursive: true });
    await fs.writeFile(samplePath, sampleContent);

    mockReq.query.type = "sample";
    config.getPipelineConfig.mockReturnValue({ pipelineJsonPath });

    await handleSchemaFileRequest(mockReq, mockRes);

    expect(mockRes.writeHead).toHaveBeenCalledWith(200, {
      "content-type": "application/json",
      connection: "close",
    });
    expect(mockRes.end).toHaveBeenCalledWith(
      JSON.stringify({
        ok: true,
        data: sampleContent,
      })
    );
  });

  it("accepts valid fileName with dots, hyphens, and underscores", async () => {
    const pipelineDir = tempDir;
    const pipelineJsonPath = path.join(pipelineDir, "pipeline.json");
    const schemasDir = path.join(pipelineDir, "schemas");
    const schemaPath = path.join(schemasDir, "valid-file_name.v2.schema.json");

    const schemaContent = "{}";

    await fs.mkdir(schemasDir, { recursive: true });
    await fs.writeFile(schemaPath, schemaContent);

    mockReq.params.fileName = "valid-file_name.v2.json";
    config.getPipelineConfig.mockReturnValue({ pipelineJsonPath });

    await handleSchemaFileRequest(mockReq, mockRes);

    expect(mockRes.writeHead).toHaveBeenCalledWith(200, {
      "content-type": "application/json",
      connection: "close",
    });
    expect(mockRes.end).toHaveBeenCalledWith(
      JSON.stringify({
        ok: true,
        data: schemaContent,
      })
    );
  });

  it("returns 500 for unexpected errors during file read", async () => {
    const pipelineDir = tempDir;
    const pipelineJsonPath = path.join(pipelineDir, "pipeline.json");

    config.getPipelineConfig.mockReturnValue({ pipelineJsonPath });

    const originalReadFile = fs.readFile;
    fs.readFile = vi.fn().mockRejectedValue(new Error("Unexpected error"));

    await handleSchemaFileRequest(mockReq, mockRes);

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
