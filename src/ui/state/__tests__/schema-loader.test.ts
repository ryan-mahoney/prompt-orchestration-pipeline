import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resetConfig } from "../../../core/config";
import { buildSchemaPromptSection, loadSchemaContext } from "../schema-loader";

describe("schema-loader", () => {
  const root = path.join(process.cwd(), ".tmp-schema-loader");
  const pipelineDir = path.join(root, "pipeline-config", "demo");
  const schemaDir = path.join(pipelineDir, "schemas");
  const registryPath = path.join(root, "pipeline-config", "registry.json");
  const previousRoot = process.env["PO_ROOT"];
  const previousNodeEnv = process.env["NODE_ENV"];

  beforeEach(async () => {
    process.env["PO_ROOT"] = root;
    process.env["NODE_ENV"] = "test";
    resetConfig();
    await Bun.write(
      registryPath,
      JSON.stringify({ pipelines: { demo: { configDir: "pipeline-config/demo", tasksDir: "tasks/demo" } } }),
    );
    await Bun.write(path.join(pipelineDir, "pipeline.json"), JSON.stringify({ slug: "demo" }));
  });

  afterEach(async () => {
    resetConfig();
    if (previousRoot === undefined) delete process.env["PO_ROOT"];
    else process.env["PO_ROOT"] = previousRoot;
    if (previousNodeEnv === undefined) delete process.env["NODE_ENV"];
    else process.env["NODE_ENV"] = previousNodeEnv;
    await Bun.$`rm -rf ${root}`.quiet();
  });

  it("loads schema, sample, and optional meta when files exist", async () => {
    await Bun.write(path.join(schemaDir, "seed.schema.json"), JSON.stringify({ type: "object" }));
    await Bun.write(path.join(schemaDir, "seed.sample.json"), JSON.stringify({ name: "demo" }));
    await Bun.write(path.join(schemaDir, "seed.meta.json"), JSON.stringify({ notes: ["x"] }));

    await expect(loadSchemaContext("demo", "seed.json")).resolves.toEqual({
      fileName: "seed.json",
      schema: { type: "object" },
      sample: { name: "demo" },
      meta: { notes: ["x"] },
    });
  });

  it("returns null for missing files or parse errors", async () => {
    await expect(loadSchemaContext("demo", "seed.json")).resolves.toBeNull();
    await Bun.write(path.join(schemaDir, "seed.schema.json"), "{");
    await Bun.write(path.join(schemaDir, "seed.sample.json"), JSON.stringify({ ok: true }));
    await expect(loadSchemaContext("demo", "seed.json")).resolves.toBeNull();
  });

  it("builds markdown sections and returns an empty string for empty input", () => {
    expect(
      buildSchemaPromptSection([
        {
          fileName: "seed.json",
          schema: { type: "object" },
          sample: { name: "demo" },
        },
      ]),
    ).toContain("## seed.json");
    expect(buildSchemaPromptSection([])).toBe("");
  });
});
