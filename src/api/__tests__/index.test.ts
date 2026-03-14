import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  submitJobWithValidation,
  PipelineOrchestrator,
  type SubmitSuccessResult,
  type SubmitFailureResult,
} from "../index.ts";

// ─── helpers ─────────────────────────────────────────────────────────────────

async function readJson(filePath: string): Promise<unknown> {
  const text = await Bun.file(filePath).text();
  return JSON.parse(text) as unknown;
}

async function scaffoldWorkspace(tmpDir: string): Promise<void> {
  const pipelineConfigDir = join(tmpDir, "pipeline-config", "test-pipeline");

  await mkdir(pipelineConfigDir, { recursive: true });
  await mkdir(join(pipelineConfigDir, "tasks"), { recursive: true });
  await mkdir(join(tmpDir, "pipeline-data", "pending"), { recursive: true });
  await mkdir(join(tmpDir, "pipeline-data", "current"), { recursive: true });
  await mkdir(join(tmpDir, "pipeline-data", "complete"), { recursive: true });

  await Bun.write(
    join(tmpDir, "pipeline-config", "registry.json"),
    JSON.stringify({
      pipelines: {
        "test-pipeline": {
          configDir: join(tmpDir, "pipeline-config", "test-pipeline"),
          tasksDir: join(tmpDir, "pipeline-config", "test-pipeline", "tasks"),
        },
      },
    }),
  );

  await Bun.write(
    join(pipelineConfigDir, "pipeline.json"),
    JSON.stringify({ name: "test-pipeline", tasks: [] }),
  );
}

// ─── submitJobWithValidation ─────────────────────────────────────────────────

describe("submitJobWithValidation", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "pop-api-submit-test-"));
    await scaffoldWorkspace(tmpDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("writes seed file to pending and returns success", async () => {
    const result = await submitJobWithValidation({
      dataDir: tmpDir,
      seedObject: { pipeline: "test-pipeline" },
    });

    expect(result.success).toBe(true);
    const success = result as SubmitSuccessResult;
    expect(success.jobId).toBeTruthy();
    expect(success.jobName).toBe(success.jobId);

    const pendingFiles = await readdir(join(tmpDir, "pipeline-data", "pending"));
    const seedFile = pendingFiles.find((f) => f.endsWith("-seed.json"));
    expect(seedFile).toBeDefined();

    const written = await readJson(join(tmpDir, "pipeline-data", "pending", seedFile!));
    expect(written).toEqual({ pipeline: "test-pipeline" });
  });

  it("returns seed name as jobName when provided", async () => {
    const result = await submitJobWithValidation({
      dataDir: tmpDir,
      seedObject: { pipeline: "test-pipeline", name: "my-job" },
    });

    expect(result.success).toBe(true);
    expect((result as SubmitSuccessResult).jobName).toBe("my-job");
  });

  it("rejects non-object seed with message containing 'JSON object'", async () => {
    const result = await submitJobWithValidation({
      dataDir: tmpDir,
      seedObject: "not an object",
    });

    expect(result.success).toBe(false);
    expect((result as SubmitFailureResult).message).toContain("JSON object");
  });

  it("rejects array seed with message containing 'JSON object'", async () => {
    const result = await submitJobWithValidation({
      dataDir: tmpDir,
      seedObject: [1, 2, 3],
    });

    expect(result.success).toBe(false);
    expect((result as SubmitFailureResult).message).toContain("JSON object");
  });

  it("rejects null seed with message containing 'JSON object'", async () => {
    const result = await submitJobWithValidation({
      dataDir: tmpDir,
      seedObject: null,
    });

    expect(result.success).toBe(false);
    expect((result as SubmitFailureResult).message).toContain("JSON object");
  });

  it("rejects seed missing pipeline field with message containing 'pipeline'", async () => {
    const result = await submitJobWithValidation({
      dataDir: tmpDir,
      seedObject: { name: "my-job" },
    });

    expect(result.success).toBe(false);
    expect((result as SubmitFailureResult).message).toContain("pipeline");
  });

  it("rejects seed with empty pipeline string", async () => {
    const result = await submitJobWithValidation({
      dataDir: tmpDir,
      seedObject: { pipeline: "" },
    });

    expect(result.success).toBe(false);
    expect((result as SubmitFailureResult).message).toContain("pipeline");
  });

  it("rejects non-existent pipeline slug with message containing 'not found'", async () => {
    const result = await submitJobWithValidation({
      dataDir: tmpDir,
      seedObject: { pipeline: "does-not-exist" },
    });

    expect(result.success).toBe(false);
    expect((result as SubmitFailureResult).message).toContain("not found");
  });

  it("rejects seed with empty name string", async () => {
    const result = await submitJobWithValidation({
      dataDir: tmpDir,
      seedObject: { pipeline: "test-pipeline", name: "" },
    });

    expect(result.success).toBe(false);
    expect((result as SubmitFailureResult).message).toContain("name");
  });
});

// ─── PipelineOrchestrator.getStatus ──────────────────────────────────────────

describe("PipelineOrchestrator.getStatus", () => {
  let tmpDir: string;
  let savedPoRoot: string | undefined;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "pop-api-status-test-"));
    await scaffoldWorkspace(tmpDir);
    savedPoRoot = process.env["PO_ROOT"];
    process.env["PO_ROOT"] = tmpDir;
  });

  afterEach(async () => {
    if (savedPoRoot === undefined) {
      delete process.env["PO_ROOT"];
    } else {
      process.env["PO_ROOT"] = savedPoRoot;
    }
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns status for job in current directory", async () => {
    const jobId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const jobDir = join(tmpDir, "pipeline-data", "current", jobId);
    await mkdir(jobDir, { recursive: true });
    await Bun.write(
      join(jobDir, "tasks-status.json"),
      JSON.stringify({
        id: jobId,
        name: "current-job",
        pipeline: "test-pipeline",
        state: "running",
        createdAt: "2026-01-01T00:00:00.000Z",
        tasks: {},
      }),
    );

    const orch = new PipelineOrchestrator({ autoStart: false });
    const record = await orch.getStatus(jobId);

    expect(record.jobId).toBe(jobId);
    expect(record.jobName).toBe("current-job");
    expect(record.pipeline).toBe("test-pipeline");
  });

  it("returns status for job in complete directory", async () => {
    const jobId = "ffffffff-1111-2222-3333-444444444444";
    const jobDir = join(tmpDir, "pipeline-data", "complete", jobId);
    await mkdir(jobDir, { recursive: true });
    await Bun.write(
      join(jobDir, "tasks-status.json"),
      JSON.stringify({
        id: jobId,
        name: "done-job",
        pipeline: "test-pipeline",
        state: "complete",
        createdAt: "2026-01-01T00:00:00.000Z",
        tasks: {},
      }),
    );

    const orch = new PipelineOrchestrator({ autoStart: false });
    const record = await orch.getStatus(jobId);

    expect(record.jobId).toBe(jobId);
    expect(record.jobName).toBe("done-job");
  });

  it("finds job by name scan fallback", async () => {
    const jobId = "11111111-2222-3333-4444-555555555555";
    const jobDir = join(tmpDir, "pipeline-data", "current", jobId);
    await mkdir(jobDir, { recursive: true });
    await Bun.write(
      join(jobDir, "tasks-status.json"),
      JSON.stringify({
        id: jobId,
        name: "named-job",
        pipeline: "test-pipeline",
        state: "running",
        createdAt: "2026-01-01T00:00:00.000Z",
        tasks: {},
      }),
    );

    const orch = new PipelineOrchestrator({ autoStart: false });
    const record = await orch.getStatus("named-job");

    expect(record.jobId).toBe(jobId);
    expect(record.jobName).toBe("named-job");
  });

  it("returns pending record for seed file in pending directory", async () => {
    const jobId = "22222222-3333-4444-5555-666666666666";
    await Bun.write(
      join(tmpDir, "pipeline-data", "pending", `${jobId}-seed.json`),
      JSON.stringify({ pipeline: "test-pipeline", name: "pending-job" }),
    );

    const orch = new PipelineOrchestrator({ autoStart: false });
    const record = await orch.getStatus(jobId);

    expect(record.jobId).toBe(jobId);
    expect(record.jobName).toBe("pending-job");
    expect(record.state).toBe("pending");
    expect(record.pipeline).toBe("test-pipeline");
    expect(record.createdAt).toBeTruthy();
  });

  it("throws for nonexistent job with message containing 'not found'", async () => {
    const orch = new PipelineOrchestrator({ autoStart: false });

    await expect(orch.getStatus("nonexistent-id")).rejects.toThrow("not found");
  });
});

// ─── PipelineOrchestrator.listJobs ───────────────────────────────────────────

describe("PipelineOrchestrator.listJobs", () => {
  let tmpDir: string;
  let savedPoRoot: string | undefined;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "pop-api-list-test-"));
    await scaffoldWorkspace(tmpDir);
    savedPoRoot = process.env["PO_ROOT"];
    process.env["PO_ROOT"] = tmpDir;
  });

  afterEach(async () => {
    if (savedPoRoot === undefined) {
      delete process.env["PO_ROOT"];
    } else {
      process.env["PO_ROOT"] = savedPoRoot;
    }
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns combined records from pending, current, and complete", async () => {
    // Pending job
    const pendingId = "aaaa-bbbb-cccc-dddd-1111";
    await Bun.write(
      join(tmpDir, "pipeline-data", "pending", `${pendingId}-seed.json`),
      JSON.stringify({ pipeline: "test-pipeline", name: "pending-one" }),
    );

    // Current job
    const currentId = "aaaa-bbbb-cccc-dddd-2222";
    const currentDir = join(tmpDir, "pipeline-data", "current", currentId);
    await mkdir(currentDir, { recursive: true });
    await Bun.write(
      join(currentDir, "tasks-status.json"),
      JSON.stringify({
        id: currentId,
        name: "current-one",
        pipeline: "test-pipeline",
        state: "running",
        createdAt: "2026-01-01T00:00:00.000Z",
        tasks: {},
      }),
    );

    // Complete job
    const completeId = "aaaa-bbbb-cccc-dddd-3333";
    const completeDir = join(tmpDir, "pipeline-data", "complete", completeId);
    await mkdir(completeDir, { recursive: true });
    await Bun.write(
      join(completeDir, "tasks-status.json"),
      JSON.stringify({
        id: completeId,
        name: "complete-one",
        pipeline: "test-pipeline",
        state: "complete",
        createdAt: "2026-01-01T00:00:00.000Z",
        tasks: {},
      }),
    );

    const orch = new PipelineOrchestrator({ autoStart: false });
    const jobs = await orch.listJobs();

    expect(jobs.length).toBe(3);

    const ids = jobs.map((j) => j.jobId);
    expect(ids).toContain(pendingId);
    expect(ids).toContain(currentId);
    expect(ids).toContain(completeId);

    const pending = jobs.find((j) => j.jobId === pendingId)!;
    expect(pending.state).toBe("pending");

    const complete = jobs.find((j) => j.jobId === completeId)!;
    expect(complete.state).toBe("complete");
  });

  it("returns empty array when all directories are empty", async () => {
    const orch = new PipelineOrchestrator({ autoStart: false });
    const jobs = await orch.listJobs();

    expect(jobs).toEqual([]);
  });

  it("does not throw when pipeline-data directories are missing", async () => {
    // Remove all pipeline-data directories
    await rm(join(tmpDir, "pipeline-data"), { recursive: true, force: true });

    const orch = new PipelineOrchestrator({ autoStart: false });
    const jobs = await orch.listJobs();

    expect(jobs).toEqual([]);
  });
});
