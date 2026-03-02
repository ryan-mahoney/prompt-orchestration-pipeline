import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { writeSchemaFiles } from "../enrichers/schema-writer.ts";
import type { DeducedSchema } from "../types.ts";

const VALID_SCHEMA = {
  $schema: "http://json-schema.org/draft-07/schema#",
  type: "object",
  properties: { id: { type: "string" }, value: { type: "number" } },
  required: ["id", "value"],
};

const VALID_DEDUCED: DeducedSchema = {
  schema: VALID_SCHEMA,
  example: { id: "abc", value: 42 },
  reasoning: "Inferred from pipeline usage.",
};

let tmpDir: string;

beforeAll(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), "schema-writer-test-"));
});

afterAll(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("writeSchemaFiles", () => {
  it("writes three files to {pipelinePath}/schemas/ for a valid artifact name", async () => {
    const pipelinePath = path.join(tmpDir, "pipeline-1");

    await writeSchemaFiles(pipelinePath, "output.json", VALID_DEDUCED);

    const schemasDir = path.join(pipelinePath, "schemas");
    expect(existsSync(path.join(schemasDir, "output.schema.json"))).toBe(true);
    expect(existsSync(path.join(schemasDir, "output.sample.json"))).toBe(true);
    expect(existsSync(path.join(schemasDir, "output.meta.json"))).toBe(true);
  });

  it("schema file contains the schema JSON", async () => {
    const pipelinePath = path.join(tmpDir, "pipeline-2");

    await writeSchemaFiles(pipelinePath, "output.json", VALID_DEDUCED);

    const schemaFile = await Bun.file(
      path.join(pipelinePath, "schemas", "output.schema.json"),
    ).text();
    expect(JSON.parse(schemaFile)).toEqual(VALID_SCHEMA);
  });

  it("meta file contains source and generatedAt", async () => {
    const pipelinePath = path.join(tmpDir, "pipeline-3");
    const before = new Date();

    await writeSchemaFiles(pipelinePath, "output.json", VALID_DEDUCED);

    const after = new Date();
    const metaFile = await Bun.file(
      path.join(pipelinePath, "schemas", "output.meta.json"),
    ).text();
    const meta = JSON.parse(metaFile) as {
      source: string;
      generatedAt: string;
      reasoning: string;
    };

    expect(meta.source).toBe("llm-deduction");
    expect(typeof meta.generatedAt).toBe("string");

    const generatedAt = new Date(meta.generatedAt);
    expect(generatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(generatedAt.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it("derives baseName by stripping extension from artifactName", async () => {
    const pipelinePath = path.join(tmpDir, "pipeline-4");

    await writeSchemaFiles(pipelinePath, "my-artifact.json", VALID_DEDUCED);

    const schemasDir = path.join(pipelinePath, "schemas");
    expect(existsSync(path.join(schemasDir, "my-artifact.schema.json"))).toBe(
      true,
    );
    expect(existsSync(path.join(schemasDir, "my-artifact.sample.json"))).toBe(
      true,
    );
    expect(existsSync(path.join(schemasDir, "my-artifact.meta.json"))).toBe(
      true,
    );
  });

  it("throws when schema is missing (undefined)", async () => {
    const pipelinePath = path.join(tmpDir, "pipeline-5");
    const bad = { example: { id: "x" }, reasoning: "ok" } as unknown as DeducedSchema;

    await expect(
      writeSchemaFiles(pipelinePath, "output.json", bad),
    ).rejects.toThrow(/Invalid schema/);
  });

  it("throws when schema is null", async () => {
    const pipelinePath = path.join(tmpDir, "pipeline-6");
    const bad = {
      schema: null,
      example: { id: "x" },
      reasoning: "ok",
    } as unknown as DeducedSchema;

    await expect(
      writeSchemaFiles(pipelinePath, "output.json", bad),
    ).rejects.toThrow(/Invalid schema/);
  });

  it("throws when schema is an array", async () => {
    const pipelinePath = path.join(tmpDir, "pipeline-7");
    const bad = {
      schema: [],
      example: { id: "x" },
      reasoning: "ok",
    } as unknown as DeducedSchema;

    await expect(
      writeSchemaFiles(pipelinePath, "output.json", bad),
    ).rejects.toThrow(/Invalid schema/);
  });

  it("throws when reasoning is not a string", async () => {
    const pipelinePath = path.join(tmpDir, "pipeline-8");
    const bad = {
      schema: VALID_SCHEMA,
      example: { id: "x" },
      reasoning: 42,
    } as unknown as DeducedSchema;

    await expect(
      writeSchemaFiles(pipelinePath, "output.json", bad),
    ).rejects.toThrow(/Invalid reasoning/);
  });

  it("throws when example is a primitive", async () => {
    const pipelinePath = path.join(tmpDir, "pipeline-9");
    const bad = {
      schema: VALID_SCHEMA,
      example: "not-an-object",
      reasoning: "ok",
    } as unknown as DeducedSchema;

    await expect(
      writeSchemaFiles(pipelinePath, "output.json", bad),
    ).rejects.toThrow(/Invalid example/);
  });

  it("throws when example is an array", async () => {
    const pipelinePath = path.join(tmpDir, "pipeline-10");
    const bad = {
      schema: VALID_SCHEMA,
      example: [{ id: "x" }],
      reasoning: "ok",
    } as unknown as DeducedSchema;

    await expect(
      writeSchemaFiles(pipelinePath, "output.json", bad),
    ).rejects.toThrow(/Invalid example/);
  });
});
