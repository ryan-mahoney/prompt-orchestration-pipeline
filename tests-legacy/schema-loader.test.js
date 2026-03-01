import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  loadSchemaContext,
  buildSchemaPromptSection,
} from "../src/ui/lib/schema-loader.js";
import * as config from "../src/core/config.js";

describe("loadSchemaContext", () => {
  let tempDir;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "schema-loader-"));
    vi.spyOn(config, "getPipelineConfig");
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("returns context object when all files exist", async () => {
    const schemasDir = path.join(tempDir, "schemas");
    await fs.mkdir(schemasDir, { recursive: true });

    const schema = { type: "object", properties: { name: { type: "string" } } };
    const sample = { name: "example" };
    const meta = { description: "Test artifact" };

    await fs.writeFile(
      path.join(schemasDir, "test.schema.json"),
      JSON.stringify(schema)
    );
    await fs.writeFile(
      path.join(schemasDir, "test.sample.json"),
      JSON.stringify(sample)
    );
    await fs.writeFile(
      path.join(schemasDir, "test.meta.json"),
      JSON.stringify(meta)
    );

    config.getPipelineConfig.mockReturnValue({
      pipelineJsonPath: path.join(tempDir, "pipeline.json"),
    });

    const result = await loadSchemaContext("test-pipeline", "test.json");

    expect(result).toEqual({
      fileName: "test.json",
      schema,
      sample,
      meta,
    });
  });

  it("returns context without meta when meta file missing", async () => {
    const schemasDir = path.join(tempDir, "schemas");
    await fs.mkdir(schemasDir, { recursive: true });

    const schema = { type: "object" };
    const sample = { value: 123 };

    await fs.writeFile(
      path.join(schemasDir, "data.schema.json"),
      JSON.stringify(schema)
    );
    await fs.writeFile(
      path.join(schemasDir, "data.sample.json"),
      JSON.stringify(sample)
    );

    config.getPipelineConfig.mockReturnValue({
      pipelineJsonPath: path.join(tempDir, "pipeline.json"),
    });

    const result = await loadSchemaContext("test-pipeline", "data.json");

    expect(result).toEqual({
      fileName: "data.json",
      schema,
      sample,
      meta: undefined,
    });
  });

  it("returns null when schema file missing", async () => {
    const schemasDir = path.join(tempDir, "schemas");
    await fs.mkdir(schemasDir, { recursive: true });

    await fs.writeFile(
      path.join(schemasDir, "test.sample.json"),
      JSON.stringify({ sample: true })
    );

    config.getPipelineConfig.mockReturnValue({
      pipelineJsonPath: path.join(tempDir, "pipeline.json"),
    });

    const result = await loadSchemaContext("test-pipeline", "test.json");

    expect(result).toBeNull();
  });

  it("returns null when sample file missing", async () => {
    const schemasDir = path.join(tempDir, "schemas");
    await fs.mkdir(schemasDir, { recursive: true });

    await fs.writeFile(
      path.join(schemasDir, "test.schema.json"),
      JSON.stringify({ type: "object" })
    );

    config.getPipelineConfig.mockReturnValue({
      pipelineJsonPath: path.join(tempDir, "pipeline.json"),
    });

    const result = await loadSchemaContext("test-pipeline", "test.json");

    expect(result).toBeNull();
  });

  it("returns null on JSON parse error", async () => {
    const schemasDir = path.join(tempDir, "schemas");
    await fs.mkdir(schemasDir, { recursive: true });

    await fs.writeFile(
      path.join(schemasDir, "test.schema.json"),
      "invalid json"
    );
    await fs.writeFile(
      path.join(schemasDir, "test.sample.json"),
      JSON.stringify({})
    );

    config.getPipelineConfig.mockReturnValue({
      pipelineJsonPath: path.join(tempDir, "pipeline.json"),
    });

    const result = await loadSchemaContext("test-pipeline", "test.json");

    expect(result).toBeNull();
  });

  it("returns null when pipeline not found", async () => {
    config.getPipelineConfig.mockImplementation(() => {
      throw new Error("Pipeline not found in registry");
    });

    const result = await loadSchemaContext("nonexistent", "test.json");

    expect(result).toBeNull();
  });
});

describe("buildSchemaPromptSection", () => {
  it("returns empty string for empty contexts array", () => {
    expect(buildSchemaPromptSection([])).toBe("");
  });

  it("returns empty string for null contexts", () => {
    expect(buildSchemaPromptSection(null)).toBe("");
  });

  it("returns empty string for undefined contexts", () => {
    expect(buildSchemaPromptSection(undefined)).toBe("");
  });

  it("builds correct prompt section from single context", () => {
    const contexts = [
      {
        fileName: "test.json",
        schema: { type: "object" },
        sample: { name: "example" },
      },
    ];

    const result = buildSchemaPromptSection(contexts);

    expect(result).toContain("## Referenced Files");
    expect(result).toContain("### @test.json");
    expect(result).toContain("**JSON Schema:**");
    expect(result).toContain('"type": "object"');
    expect(result).toContain("**Sample Data:**");
    expect(result).toContain('"name": "example"');
  });

  it("builds correct prompt section from multiple contexts", () => {
    const contexts = [
      {
        fileName: "input.json",
        schema: { type: "array" },
        sample: [1, 2, 3],
      },
      {
        fileName: "output.json",
        schema: { type: "string" },
        sample: "result",
      },
    ];

    const result = buildSchemaPromptSection(contexts);

    expect(result).toContain("## Referenced Files");
    expect(result).toContain("### @input.json");
    expect(result).toContain("### @output.json");
    expect(result).toContain('"type": "array"');
    expect(result).toContain('"type": "string"');
  });
});
