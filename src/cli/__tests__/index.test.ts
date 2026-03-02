import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { access } from "node:fs/promises";

import {
  handleInit,
  handleAddPipeline,
  handleAddPipelineTask,
  handleSubmit,
  parseTaskIndex,
  serializeTaskIndex,
} from "../index.ts";

// ─── helpers ─────────────────────────────────────────────────────────────────

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readJson(path: string): Promise<unknown> {
  const text = await Bun.file(path).text();
  return JSON.parse(text) as unknown;
}

// ─── handleInit ──────────────────────────────────────────────────────────────

describe("handleInit", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "pop-init-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("creates pipeline-config directory", async () => {
    await handleInit(tmpDir);
    expect(await exists(join(tmpDir, "pipeline-config"))).toBe(true);
  });

  it("creates all pipeline-data subdirectories", async () => {
    await handleInit(tmpDir);
    for (const sub of ["pending", "current", "complete", "rejected"]) {
      expect(await exists(join(tmpDir, "pipeline-data", sub))).toBe(true);
    }
  });

  it("writes .gitkeep in each pipeline-data subdirectory", async () => {
    await handleInit(tmpDir);
    for (const sub of ["pending", "current", "complete", "rejected"]) {
      expect(await exists(join(tmpDir, "pipeline-data", sub, ".gitkeep"))).toBe(true);
    }
  });

  it("writes registry.json with empty pipelines", async () => {
    await handleInit(tmpDir);
    const reg = await readJson(join(tmpDir, "registry.json"));
    expect(reg).toEqual({ pipelines: {} });
  });

  it("writes registry.json with trailing newline", async () => {
    await handleInit(tmpDir);
    const text = await Bun.file(join(tmpDir, "registry.json")).text();
    expect(text.endsWith("\n")).toBe(true);
  });

  it("is idempotent — can be re-run without error", async () => {
    await handleInit(tmpDir);
    await expect(handleInit(tmpDir)).resolves.toBeUndefined();
  });
});

// ─── handleAddPipeline ────────────────────────────────────────────────────────

describe("handleAddPipeline", () => {
  let tmpDir: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let exitSpy: MockInstance<any>;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "pop-add-pipeline-test-"));
    // Initialize workspace so registry.json exists
    await handleInit(tmpDir);
    exitSpy = vi.spyOn(process, "exit").mockImplementation(
      (_code?: string | number | null | undefined) => {
        throw new Error(`process.exit(${_code})`);
      }
    );
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
    exitSpy.mockRestore();
    vi.clearAllMocks();
  });

  it("creates pipeline-config/<slug>/tasks/ directory tree", async () => {
    await handleAddPipeline("my-pipeline", tmpDir);
    expect(await exists(join(tmpDir, "pipeline-config", "my-pipeline", "tasks"))).toBe(true);
  });

  it("writes pipeline.json with correct content", async () => {
    await handleAddPipeline("my-pipeline", tmpDir);
    const config = await readJson(join(tmpDir, "pipeline-config", "my-pipeline", "pipeline.json"));
    expect(config).toEqual({
      name: "my-pipeline",
      version: "1.0.0",
      description: "New pipeline",
      tasks: [],
    });
  });

  it("writes tasks/index.ts", async () => {
    await handleAddPipeline("my-pipeline", tmpDir);
    const content = await Bun.file(join(tmpDir, "pipeline-config", "my-pipeline", "tasks", "index.ts")).text();
    expect(content).toBe("export default {};\n");
  });

  it("adds entry to registry.json", async () => {
    await handleAddPipeline("my-pipeline", tmpDir);
    const reg = await readJson(join(tmpDir, "registry.json")) as { pipelines: Record<string, unknown> };
    expect(reg.pipelines["my-pipeline"]).toBeDefined();
    const entry = reg.pipelines["my-pipeline"] as Record<string, unknown>;
    expect(entry["name"]).toBe("my-pipeline");
    expect(entry["description"]).toBe("New pipeline");
  });

  it("stores .ts paths in registry entry", async () => {
    await handleAddPipeline("my-pipeline", tmpDir);
    const reg = await readJson(join(tmpDir, "registry.json")) as { pipelines: Record<string, unknown> };
    const entry = reg.pipelines["my-pipeline"] as Record<string, string>;
    expect(entry["taskRegistryPath"]).toMatch(/index\.ts$/);
    expect(entry["pipelinePath"]).toMatch(/pipeline\.json$/);
  });

  it("exits with 1 on invalid slug", async () => {
    await expect(handleAddPipeline("INVALID", tmpDir)).rejects.toThrow("process.exit(1)");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits with 1 on slug with underscores", async () => {
    await expect(handleAddPipeline("my_pipeline", tmpDir)).rejects.toThrow("process.exit(1)");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

// ─── handleAddPipelineTask ────────────────────────────────────────────────────

describe("handleAddPipelineTask", () => {
  let tmpDir: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let exitSpy: MockInstance<any>;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "pop-add-task-test-"));
    await handleInit(tmpDir);
    // handleAddPipeline needs process.exit not mocked during setup
    await handleAddPipeline("my-pipeline", tmpDir);
    exitSpy = vi.spyOn(process, "exit").mockImplementation(
      (_code?: string | number | null | undefined) => {
        throw new Error(`process.exit(${_code})`);
      }
    );
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
    exitSpy.mockRestore();
    vi.clearAllMocks();
  });

  it("creates task file with 11 stage stubs", async () => {
    await handleAddPipelineTask("my-pipeline", "my-task", tmpDir);
    const content = await Bun.file(
      join(tmpDir, "pipeline-config", "my-pipeline", "tasks", "my-task.ts")
    ).text();

    const stages = [
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
    ];
    for (const stage of stages) {
      expect(content).toContain(`export async function ${stage}(`);
    }
  });

  it("ingestion stage has { seed } destructuring", async () => {
    await handleAddPipelineTask("my-pipeline", "my-task", tmpDir);
    const content = await Bun.file(
      join(tmpDir, "pipeline-config", "my-pipeline", "tasks", "my-task.ts")
    ).text();
    expect(content).toContain("ingestion({ data: { seed } }");
  });

  it("non-ingestion stages have { data } parameter", async () => {
    await handleAddPipelineTask("my-pipeline", "my-task", tmpDir);
    const content = await Bun.file(
      join(tmpDir, "pipeline-config", "my-pipeline", "tasks", "my-task.ts")
    ).text();
    expect(content).toContain("preProcessing({ data }");
    expect(content).toContain("inference({ data }");
  });

  it("task file stubs return { output: {}, flags: {} }", async () => {
    await handleAddPipelineTask("my-pipeline", "my-task", tmpDir);
    const content = await Bun.file(
      join(tmpDir, "pipeline-config", "my-pipeline", "tasks", "my-task.ts")
    ).text();
    expect(content).toContain("return { output: {}, flags: {} }");
  });

  it("updates tasks/index.ts with new task entry", async () => {
    await handleAddPipelineTask("my-pipeline", "my-task", tmpDir);
    const content = await Bun.file(
      join(tmpDir, "pipeline-config", "my-pipeline", "tasks", "index.ts")
    ).text();
    expect(content).toContain('"my-task"');
    expect(content).toContain("./my-task.ts");
  });

  it("sorts task index keys alphabetically", async () => {
    await handleAddPipelineTask("my-pipeline", "b-task", tmpDir);
    await handleAddPipelineTask("my-pipeline", "a-task", tmpDir);
    const content = await Bun.file(
      join(tmpDir, "pipeline-config", "my-pipeline", "tasks", "index.ts")
    ).text();
    const aPos = content.indexOf('"a-task"');
    const bPos = content.indexOf('"b-task"');
    expect(aPos).toBeLessThan(bPos);
  });

  it("updates pipeline.json with task slug", async () => {
    await handleAddPipelineTask("my-pipeline", "my-task", tmpDir);
    const config = await readJson(
      join(tmpDir, "pipeline-config", "my-pipeline", "pipeline.json")
    ) as { tasks: string[] };
    expect(config.tasks).toContain("my-task");
  });

  it("exits with 1 on invalid pipeline slug", async () => {
    await expect(handleAddPipelineTask("INVALID", "my-task", tmpDir)).rejects.toThrow("process.exit(1)");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits with 1 on invalid task slug", async () => {
    await expect(handleAddPipelineTask("my-pipeline", "INVALID_TASK", tmpDir)).rejects.toThrow("process.exit(1)");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits with 1 when tasks/index.ts has single-quoted keys (manually modified)", async () => {
    const indexPath = join(tmpDir, "pipeline-config", "my-pipeline", "tasks", "index.ts");
    await Bun.write(indexPath, "export default { 'foo': './foo.ts' };\n");
    await expect(handleAddPipelineTask("my-pipeline", "my-task", tmpDir)).rejects.toThrow("process.exit(1)");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits with 1 when tasks/index.ts has arbitrary content", async () => {
    const indexPath = join(tmpDir, "pipeline-config", "my-pipeline", "tasks", "index.ts");
    await Bun.write(indexPath, "const x = { foo: './foo.ts' };\nexport default x;\n");
    await expect(handleAddPipelineTask("my-pipeline", "my-task", tmpDir)).rejects.toThrow("process.exit(1)");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

// ─── handleSubmit ─────────────────────────────────────────────────────────────

describe("handleSubmit", () => {
  let tmpDir: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let exitSpy: MockInstance<any>;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "pop-submit-test-"));
    exitSpy = vi.spyOn(process, "exit").mockImplementation(
      (_code?: string | number | null | undefined) => {
        throw new Error(`process.exit(${_code})`);
      }
    );
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
    exitSpy.mockRestore();
    vi.clearAllMocks();
  });

  it("exits with 1 on missing seed file", async () => {
    await expect(handleSubmit(join(tmpDir, "nonexistent.json"))).rejects.toThrow("process.exit(1)");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits with 1 on invalid JSON in seed file", async () => {
    const seedPath = join(tmpDir, "bad-seed.json");
    await Bun.write(seedPath, "{ invalid json }");
    await expect(handleSubmit(seedPath)).rejects.toThrow("process.exit(1)");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits with 1 when submitJobWithValidation throws (API not yet implemented)", async () => {
    const seedPath = join(tmpDir, "seed.json");
    await Bun.write(seedPath, JSON.stringify({ pipeline: "test-pipeline" }));
    // submitJobWithValidation throws "not yet implemented" — treated as API failure
    await expect(handleSubmit(seedPath)).rejects.toThrow("process.exit(1)");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

// ─── parseTaskIndex ───────────────────────────────────────────────────────────

describe("parseTaskIndex", () => {
  it("parses an empty export default", () => {
    const result = parseTaskIndex("export default {};\n");
    expect(result).toEqual(new Map());
  });

  it("parses entries from canonical format", () => {
    const content = `export default {\n  "foo": "./foo.ts",\n  "bar": "./bar.ts",\n};\n`;
    const result = parseTaskIndex(content);
    expect(result).not.toBeNull();
    expect(result!.get("foo")).toBe("./foo.ts");
    expect(result!.get("bar")).toBe("./bar.ts");
  });

  it("returns null for single-quoted keys", () => {
    const result = parseTaskIndex("export default { 'foo': './foo.ts' };\n");
    expect(result).toBeNull();
  });

  it("returns null for content without export default pattern", () => {
    const result = parseTaskIndex("const x = {};\nexport default x;\n");
    expect(result).toBeNull();
  });

  it("returns null for multiline non-conforming content", () => {
    const result = parseTaskIndex("export { foo };\n");
    expect(result).toBeNull();
  });
});

// ─── serializeTaskIndex ───────────────────────────────────────────────────────

describe("serializeTaskIndex", () => {
  it("serializes empty map as empty export default", () => {
    const result = serializeTaskIndex(new Map());
    expect(result).toBe("export default {\n};\n");
  });

  it("serializes entries with 2-space indent and trailing comma", () => {
    const map = new Map([["foo", "./foo.ts"]]);
    const result = serializeTaskIndex(map);
    expect(result).toBe(`export default {\n  "foo": "./foo.ts",\n};\n`);
  });

  it("sorts keys alphabetically", () => {
    const map = new Map([["zebra", "./z.ts"], ["apple", "./a.ts"], ["mango", "./m.ts"]]);
    const result = serializeTaskIndex(map);
    const applePos = result.indexOf('"apple"');
    const mangoPos = result.indexOf('"mango"');
    const zebraPos = result.indexOf('"zebra"');
    expect(applePos).toBeLessThan(mangoPos);
    expect(mangoPos).toBeLessThan(zebraPos);
  });

  it("ends with trailing newline", () => {
    const map = new Map([["a", "./a.ts"]]);
    expect(serializeTaskIndex(map).endsWith("\n")).toBe(true);
  });
});
