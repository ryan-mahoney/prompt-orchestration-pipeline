import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { runPipeline } from "../task-runner";
import type { StatusSnapshot } from "../status-writer";

const tempRoots: string[] = [];

async function makeTempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "task-runner-"));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("runPipeline log tracking", () => {
  it("registers stage start, context, and completion logs on the task", async () => {
    const root = await makeTempRoot();
    const workDir = path.join(root, "job-1");
    await mkdir(workDir, { recursive: true });
    await writeFile(path.join(workDir, "seed.json"), JSON.stringify({ topic: "x" }));
    await writeFile(path.join(workDir, "tasks-status.json"), JSON.stringify({ id: "job-1", tasks: {} }));

    const modulePath = path.join(root, "task-module.mjs");
    await writeFile(
      modulePath,
      [
        "export const ingestion = async ({ flags }) => ({ output: { ok: true }, flags });",
      ].join("\n"),
    );

    const result = await runPipeline(modulePath, {
      workDir,
      taskName: "research",
      statusPath: path.join(workDir, "tasks-status.json"),
      jobId: "job-1",
      envLoaded: true,
      seed: { data: { topic: "x" } },
      pipelineTasks: ["research"],
      llm: {} as never,
    });

    expect(result.ok).toBe(true);

    const status = JSON.parse(await readFile(path.join(workDir, "tasks-status.json"), "utf8")) as {
      tasks?: Record<string, { files?: { logs?: string[] } }>;
    };

    expect(status.tasks?.["research"]?.files?.logs).toEqual([
      "research-ingestion-context.json",
      "research-ingestion-complete.log",
      "research-ingestion-start.log",
    ]);
  });
});

describe("task-runner does not write job-level status fields", () => {
  it("does not set snapshot.state, snapshot.current, snapshot.currentStage, or snapshot.progress on success", async () => {
    const root = await makeTempRoot();
    const workDir = path.join(root, "job-1");
    await mkdir(workDir, { recursive: true });
    await writeFile(path.join(workDir, "seed.json"), JSON.stringify({ topic: "x" }));
    await writeFile(
      path.join(workDir, "tasks-status.json"),
      JSON.stringify({ id: "job-1", state: "pending", current: null, currentStage: null, tasks: {} }),
    );

    const modulePath = path.join(root, "task-module.mjs");
    await writeFile(
      modulePath,
      "export const ingestion = async ({ flags }) => ({ output: { ok: true }, flags });",
    );

    const result = await runPipeline(modulePath, {
      workDir,
      taskName: "research",
      statusPath: path.join(workDir, "tasks-status.json"),
      jobId: "job-1",
      envLoaded: true,
      seed: { data: { topic: "x" } },
      pipelineTasks: ["research"],
      llm: {} as never,
    });

    expect(result.ok).toBe(true);

    const status = JSON.parse(await readFile(path.join(workDir, "tasks-status.json"), "utf8")) as StatusSnapshot;

    // Job-level fields must remain untouched by task-runner
    expect(status.state).toBe("pending");
    expect(status.current).toBeNull();
    expect(status.currentStage).toBeNull();
    expect(status.progress).toBeUndefined();
  });

  it("does not set snapshot.state on task failure", async () => {
    const root = await makeTempRoot();
    const workDir = path.join(root, "job-1");
    await mkdir(workDir, { recursive: true });
    await writeFile(path.join(workDir, "seed.json"), JSON.stringify({ topic: "x" }));
    await writeFile(
      path.join(workDir, "tasks-status.json"),
      JSON.stringify({ id: "job-1", state: "pending", current: null, currentStage: null, tasks: {} }),
    );

    const modulePath = path.join(root, "task-module.mjs");
    await writeFile(
      modulePath,
      'export const ingestion = async () => { throw new Error("boom"); };',
    );

    const result = await runPipeline(modulePath, {
      workDir,
      taskName: "research",
      statusPath: path.join(workDir, "tasks-status.json"),
      jobId: "job-1",
      envLoaded: true,
      seed: { data: { topic: "x" } },
      pipelineTasks: ["research"],
      llm: {} as never,
    });

    expect(result.ok).toBe(false);

    const status = JSON.parse(await readFile(path.join(workDir, "tasks-status.json"), "utf8")) as StatusSnapshot;

    // Job-level state must remain "pending" -- task-runner does not own it
    expect(status.state).toBe("pending");
    expect(status.current).toBeNull();
    expect(status.currentStage).toBeNull();
  });
});

describe("task-runner writes correct task-level state transitions", () => {
  it("transitions task through running -> done on success", async () => {
    const root = await makeTempRoot();
    const workDir = path.join(root, "job-1");
    await mkdir(workDir, { recursive: true });
    await writeFile(path.join(workDir, "seed.json"), JSON.stringify({ topic: "x" }));
    await writeFile(
      path.join(workDir, "tasks-status.json"),
      JSON.stringify({ id: "job-1", state: "pending", current: null, currentStage: null, tasks: {} }),
    );

    const modulePath = path.join(root, "task-module.mjs");
    await writeFile(
      modulePath,
      "export const ingestion = async ({ flags }) => ({ output: { ok: true }, flags });",
    );

    const result = await runPipeline(modulePath, {
      workDir,
      taskName: "research",
      statusPath: path.join(workDir, "tasks-status.json"),
      jobId: "job-1",
      envLoaded: true,
      seed: { data: { topic: "x" } },
      pipelineTasks: ["research"],
      llm: {} as never,
    });

    expect(result.ok).toBe(true);

    const status = JSON.parse(await readFile(path.join(workDir, "tasks-status.json"), "utf8")) as StatusSnapshot;
    const task = status.tasks["research"];

    expect(task).toBeDefined();
    expect(task!.state).toBe("done");
    expect(task!.currentStage).toBeNull();
  });

  it("transitions task to failed with error details on stage failure", async () => {
    const root = await makeTempRoot();
    const workDir = path.join(root, "job-1");
    await mkdir(workDir, { recursive: true });
    await writeFile(path.join(workDir, "seed.json"), JSON.stringify({ topic: "x" }));
    await writeFile(
      path.join(workDir, "tasks-status.json"),
      JSON.stringify({ id: "job-1", state: "pending", current: null, currentStage: null, tasks: {} }),
    );

    const modulePath = path.join(root, "task-module.mjs");
    await writeFile(
      modulePath,
      'export const ingestion = async () => { throw new Error("stage exploded"); };',
    );

    const result = await runPipeline(modulePath, {
      workDir,
      taskName: "research",
      statusPath: path.join(workDir, "tasks-status.json"),
      jobId: "job-1",
      envLoaded: true,
      seed: { data: { topic: "x" } },
      pipelineTasks: ["research"],
      llm: {} as never,
    });

    expect(result.ok).toBe(false);

    const status = JSON.parse(await readFile(path.join(workDir, "tasks-status.json"), "utf8")) as StatusSnapshot;
    const task = status.tasks["research"];

    expect(task).toBeDefined();
    expect(task!.state).toBe("failed");
    expect(task!.failedStage).toBe("ingestion");
    expect(task!.error).toBe("stage exploded");
  });
});
