import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("analyzeTaskFile", () => {
  let tmpDir: string;
  let exitSpy: ReturnType<typeof spyOn>;
  let stdoutSpy: ReturnType<typeof spyOn>;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "analyze-task-test-"));
    exitSpy = spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as never);
    stdoutSpy = spyOn(process.stdout, "write").mockImplementation((() => true) as never);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
    exitSpy.mockRestore();
    stdoutSpy.mockRestore();
  });

  it("outputs JSON result for a valid task file", async () => {
    const taskFile = join(tmpDir, "task.ts");
    await writeFile(
      taskFile,
      'export async function ingestion({ io, llm }) { await io.readArtifact("seed.json"); await llm.openai.complete({ prompt: "json" }); }',
    );

    const { analyzeTaskFile } = await import("../analyze-task.ts");
    await analyzeTaskFile(taskFile);

    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const written = (stdoutSpy.mock.calls[0] as [string])[0];
    const parsed = JSON.parse(written);
    expect(parsed.taskFilePath).toBe(taskFile);
    expect(parsed.stages).toEqual([{ name: "ingestion", order: 1, isAsync: true }]);
    expect(parsed.artifacts.reads).toEqual([{ fileName: "seed.json", stage: "ingestion", required: true }]);
    expect(parsed.models).toEqual([{ provider: "openai", method: "complete", stage: "ingestion" }]);
  });

  it("calls process.exit(1) for a non-existent file", async () => {
    const { analyzeTaskFile } = await import("../analyze-task.ts");
    await expect(analyzeTaskFile(join(tmpDir, "does-not-exist.ts"))).rejects.toThrow(
      "process.exit called"
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
