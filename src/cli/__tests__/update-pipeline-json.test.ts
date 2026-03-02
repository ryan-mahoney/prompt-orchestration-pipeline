import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { updatePipelineJson } from "../update-pipeline-json.ts";

describe("updatePipelineJson", () => {
  let tmpDir: string;
  let pipelineDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "update-pipeline-json-test-"));
    pipelineDir = join(tmpDir, "pipeline-config", "test-pipeline");
    await mkdir(pipelineDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("appends a task slug to existing tasks", async () => {
    const filePath = join(pipelineDir, "pipeline.json");
    await Bun.write(
      filePath,
      JSON.stringify(
        { name: "test", version: "1.0.0", description: "Test", tasks: ["a"] },
        null,
        2
      ) + "\n"
    );

    await updatePipelineJson(tmpDir, "test-pipeline", "b");

    const result = JSON.parse(await Bun.file(filePath).text());
    expect(result.tasks).toEqual(["a", "b"]);
  });

  it("does not add duplicates", async () => {
    const filePath = join(pipelineDir, "pipeline.json");
    await Bun.write(
      filePath,
      JSON.stringify(
        { name: "test", version: "1.0.0", description: "Test", tasks: ["a"] },
        null,
        2
      ) + "\n"
    );

    await updatePipelineJson(tmpDir, "test-pipeline", "b");
    await updatePipelineJson(tmpDir, "test-pipeline", "b");

    const result = JSON.parse(await Bun.file(filePath).text());
    expect(result.tasks).toEqual(["a", "b"]);
  });

  it("creates a minimal config with the task when pipeline.json is missing", async () => {
    const filePath = join(pipelineDir, "pipeline.json");

    await updatePipelineJson(tmpDir, "test-pipeline", "b");

    const result = JSON.parse(await Bun.file(filePath).text());
    expect(result.name).toBe("test-pipeline");
    expect(result.version).toBe("1.0.0");
    expect(result.description).toBe("New pipeline");
    expect(result.tasks).toEqual(["b"]);
  });
});
