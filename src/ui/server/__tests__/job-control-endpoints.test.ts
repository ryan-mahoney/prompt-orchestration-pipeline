import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Subprocess } from "bun";

import { afterEach, describe, expect, it, vi } from "vitest";

import { initPATHS, resetPATHS } from "../config-bridge-node";
import { handleJobRestart, handleJobStop, handleTaskStart } from "../endpoints/job-control-endpoints";
import { readJobStatus } from "../../../core/status-writer";

const tempRoots: string[] = [];
const childProcs: Subprocess[] = [];

async function makeTempRoot(): Promise<string> {
  const root = await Bun.$`mktemp -d ${path.join(os.tmpdir(), "job-control-XXXXXX")}`.text();
  const trimmed = root.trim();
  tempRoots.push(trimmed);
  return trimmed;
}

async function setupJob(
  root: string,
  jobId: string,
  status: Record<string, unknown>,
  pid?: number,
): Promise<string> {
  const jobDir = path.join(root, "pipeline-data", "current", jobId);
  await mkdir(jobDir, { recursive: true });
  await writeFile(path.join(jobDir, "tasks-status.json"), JSON.stringify(status));
  if (pid !== undefined) {
    await writeFile(path.join(jobDir, "runner.pid"), String(pid));
  }
  return jobDir;
}

async function setupPipelineConfig(root: string, slug: string, tasks: string[]): Promise<void> {
  const configDir = path.join(root, "pipeline-config", slug);
  await mkdir(configDir, { recursive: true });
  await writeFile(path.join(configDir, "pipeline.json"), JSON.stringify({ name: slug, tasks }));
  await writeFile(path.join(root, "pipeline-config", "registry.json"), JSON.stringify({
    pipelines: {
      [slug]: {},
    },
  }));
}

function mockRunnerSpawn(pid = 424242) {
  const proc = {
    pid,
    unref: vi.fn(),
  } as unknown as Subprocess;
  return vi.spyOn(Bun, "spawn").mockReturnValue(proc);
}

function spawnSleeper(): Subprocess {
  const proc = Bun.spawn(["sleep", "60"], {
    stdout: "ignore",
    stderr: "ignore",
    stdin: "ignore",
  });
  childProcs.push(proc);
  return proc;
}

afterEach(async () => {
  vi.restoreAllMocks();
  resetPATHS();
  for (const proc of childProcs.splice(0)) {
    try { proc.kill(); } catch {}
  }
  await Promise.all(tempRoots.splice(0).map((root) => Bun.$`rm -rf ${root}`));
});

describe("handleJobStop", () => {
  it("stops a live PID with graceful SIGTERM", async () => {
    const root = await makeTempRoot();
    initPATHS(root);

    const proc = spawnSleeper();
    const pid = proc.pid;

    const jobDir = await setupJob(root, "job-1", {
      id: "job-1",
      state: "running",
      current: "research",
      currentStage: "prompt",
      tasks: {
        research: { state: "running", currentStage: "prompt" },
      },
      files: { artifacts: [], logs: [], tmp: [] },
    }, pid);

    const req = new Request("http://localhost/api/jobs/job-1/stop", { method: "POST" });
    const res = await handleJobStop(req, "job-1", root);
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(202);
    expect(body["ok"]).toBe(true);
    expect(body["stopped"]).toBe(true);
    expect(body["signal"]).toBe("SIGTERM");
    expect(body["resetTask"]).toBe("research");

    const snapshot = await readJobStatus(jobDir);
    expect(snapshot!.state).toBe("pending");
    expect(snapshot!.current).toBe("research");
    expect(snapshot!.currentStage).toBeNull();
    expect(snapshot!.tasks["research"]!.state).toBe("pending");
  });

  it("locates the job using the explicit dataDir even when PATHS was not pre-initialized", async () => {
    const root = await makeTempRoot();

    await setupJob(root, "job-rootless", {
      id: "job-rootless",
      state: "running",
      current: "analysis",
      currentStage: null,
      tasks: {
        analysis: { state: "running", currentStage: null },
      },
      files: { artifacts: [], logs: [], tmp: [] },
    });

    const req = new Request("http://localhost/api/jobs/job-rootless/stop", { method: "POST" });
    const res = await handleJobStop(req, "job-rootless", root);
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(202);
    expect(body["ok"]).toBe(true);

    const snapshot = await readJobStatus(path.join(root, "pipeline-data", "current", "job-rootless"));
    expect(snapshot!.state).toBe("pending");
    expect(snapshot!.current).toBe("analysis");
    expect(snapshot!.tasks["analysis"]!.state).toBe("pending");
  });

  it("escalates to SIGKILL when process ignores SIGTERM", async () => {
    const root = await makeTempRoot();
    initPATHS(root);

    // Spawn a bun child that traps SIGTERM as a no-op
    const proc = Bun.spawn(
      ["bun", "-e", 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000);'],
      { stdout: "ignore", stderr: "ignore", stdin: "ignore" },
    );
    childProcs.push(proc);
    // Allow the child to start and register the handler
    await new Promise((r) => setTimeout(r, 300));
    const pid = proc.pid;

    await setupJob(root, "job-2", {
      id: "job-2",
      state: "running",
      current: "research",
      currentStage: null,
      tasks: {
        research: { state: "running", currentStage: null },
      },
      files: { artifacts: [], logs: [], tmp: [] },
    }, pid);

    const req = new Request("http://localhost/api/jobs/job-2/stop", { method: "POST" });
    const res = await handleJobStop(req, "job-2", root);
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(202);
    expect(body["ok"]).toBe(true);
    expect(body["signal"]).toBe("SIGKILL");
  }, 10000);

  it("resets snapshot.state to pending and clears running task fields", async () => {
    const root = await makeTempRoot();
    initPATHS(root);

    // No PID — process already dead
    const jobDir = await setupJob(root, "job-3", {
      id: "job-3",
      state: "running",
      current: "analysis",
      currentStage: "stage-2",
      tasks: {
        research: { state: "done", currentStage: null },
        analysis: {
          state: "running",
          currentStage: "stage-2",
          failedStage: "stage-1",
          error: "previous error",
          attempts: 3,
          refinementAttempts: 1,
          tokenUsage: [{ tokens: 100 }],
        },
      },
      files: { artifacts: [], logs: [], tmp: [] },
    });

    const req = new Request("http://localhost/api/jobs/job-3/stop", { method: "POST" });
    const res = await handleJobStop(req, "job-3", root);
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(202);
    expect(body["stopped"]).toBe(false);
    expect(body["resetTask"]).toBe("analysis");

    const snapshot = await readJobStatus(jobDir);
    expect(snapshot!.state).toBe("pending");
    expect(snapshot!.current).toBe("analysis");
    expect(snapshot!.currentStage).toBeNull();

    // Done task stays done
    expect(snapshot!.tasks["research"]!.state).toBe("done");

    // Running task is fully reset
    const analysis = snapshot!.tasks["analysis"]!;
    expect(analysis.state).toBe("pending");
    expect(analysis.currentStage).toBeNull();
    expect(analysis.failedStage).toBeUndefined();
    expect(analysis.error).toBeUndefined();
    expect(analysis.attempts).toBe(0);
    expect(analysis.refinementAttempts).toBe(0);
    expect(analysis.tokenUsage).toEqual([]);
  });

  it("resets restartCount on the running task that gets reset to pending", async () => {
    const root = await makeTempRoot();
    initPATHS(root);

    const jobDir = await setupJob(root, "job-restart-count", {
      id: "job-restart-count",
      state: "running",
      current: "analysis",
      currentStage: "stage-2",
      tasks: {
        research: { state: "done", currentStage: null },
        analysis: {
          state: "running",
          currentStage: "stage-2",
          attempts: 1,
          restartCount: 2,
        },
      },
      files: { artifacts: [], logs: [], tmp: [] },
    });

    const req = new Request("http://localhost/api/jobs/job-restart-count/stop", { method: "POST" });
    const res = await handleJobStop(req, "job-restart-count", root);
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(202);
    expect(body["resetTask"]).toBe("analysis");

    const snapshot = await readJobStatus(jobDir);
    const analysis = snapshot!.tasks["analysis"]!;
    expect(analysis.state).toBe("pending");
    expect(analysis.restartCount).toBe(0);
  });

  it("does not modify restartCount on tasks that are not reset", async () => {
    const root = await makeTempRoot();
    initPATHS(root);

    const jobDir = await setupJob(root, "job-restart-count-untouched", {
      id: "job-restart-count-untouched",
      state: "running",
      current: "analysis",
      currentStage: "stage-2",
      tasks: {
        research: { state: "done", currentStage: null, restartCount: 4 },
        analysis: {
          state: "running",
          currentStage: "stage-2",
          attempts: 1,
          restartCount: 1,
        },
      },
      files: { artifacts: [], logs: [], tmp: [] },
    });

    const req = new Request("http://localhost/api/jobs/job-restart-count-untouched/stop", { method: "POST" });
    const res = await handleJobStop(req, "job-restart-count-untouched", root);
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(202);
    expect(body["resetTask"]).toBe("analysis");

    const snapshot = await readJobStatus(jobDir);
    expect(snapshot!.tasks["research"]!.restartCount).toBe(4);
    expect(snapshot!.tasks["analysis"]!.restartCount).toBe(0);
  });

  it("recovers a stale job by resetting the first non-terminal task after partial progress", async () => {
    const root = await makeTempRoot();
    initPATHS(root);

    const jobDir = await setupJob(root, "job-5", {
      id: "job-5",
      state: "pending",
      current: null,
      currentStage: null,
      tasks: {
        research: { state: "done", endedAt: "2026-04-01T10:00:00.000Z" },
        analysis: {
          state: "pending",
          startedAt: "2026-04-01T10:01:00.000Z",
          endedAt: "2026-04-01T10:01:30.000Z",
          attempts: 2,
          refinementAttempts: 1,
          tokenUsage: [{ tokens: 100 }],
        },
        synthesis: { state: "pending" },
      },
      files: { artifacts: [], logs: [], tmp: [] },
    });

    const req = new Request("http://localhost/api/jobs/job-5/stop", { method: "POST" });
    const res = await handleJobStop(req, "job-5", root);
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(202);
    expect(body["stopped"]).toBe(false);
    expect(body["resetTask"]).toBe("analysis");

    const snapshot = await readJobStatus(jobDir);
    expect(snapshot!.state).toBe("pending");
    expect(snapshot!.current).toBe("analysis");
    expect(snapshot!.currentStage).toBeNull();
    expect(snapshot!.progress).toBe(33);
    expect(snapshot!.tasks["analysis"]!.state).toBe("pending");
    expect(snapshot!.tasks["analysis"]!.startedAt).toBeUndefined();
    expect(snapshot!.tasks["analysis"]!.endedAt).toBeUndefined();
    expect(snapshot!.tasks["analysis"]!.attempts).toBe(0);
    expect(snapshot!.tasks["analysis"]!.refinementAttempts).toBe(0);
    expect(snapshot!.tasks["analysis"]!.tokenUsage).toEqual([]);
  });

  it("handles already-dead PID gracefully", async () => {
    const root = await makeTempRoot();
    initPATHS(root);

    // Write a PID that does not exist
    const jobDir = await setupJob(root, "job-4", {
      id: "job-4",
      state: "running",
      current: null,
      currentStage: null,
      tasks: {},
      files: { artifacts: [], logs: [], tmp: [] },
    }, 999999);

    const req = new Request("http://localhost/api/jobs/job-4/stop", { method: "POST" });
    const res = await handleJobStop(req, "job-4", root);
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(202);
    expect(body["ok"]).toBe(true);
    expect(body["stopped"]).toBe(true);

    const snapshot = await readJobStatus(jobDir);
    expect(snapshot!.state).toBe("pending");
  });
});

describe("handleJobRestart", () => {
  it("returns 409 when runner PID is alive", async () => {
    const root = await makeTempRoot();
    initPATHS(root);

    const proc = spawnSleeper();

    await setupJob(root, "restart-1", {
      id: "restart-1",
      state: "running",
      current: "research",
      currentStage: "prompt",
      tasks: {
        research: { state: "running", currentStage: "prompt" },
      },
      files: { artifacts: [], logs: [], tmp: [] },
    }, proc.pid);

    const req = new Request("http://localhost/api/jobs/restart-1/restart", { method: "POST" });
    const res = await handleJobRestart(req, "restart-1", root);
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(409);
    expect(body["code"]).toBe("job_running");
  });

  it("returns 409 when PID is stale but tasks are still running", async () => {
    const root = await makeTempRoot();
    initPATHS(root);

    // PID 999999 is almost certainly dead
    await setupJob(root, "restart-2", {
      id: "restart-2",
      state: "running",
      current: "research",
      currentStage: "prompt",
      tasks: {
        research: { state: "running", currentStage: "prompt" },
      },
      files: { artifacts: [], logs: [], tmp: [] },
    }, 999999);

    const req = new Request("http://localhost/api/jobs/restart-2/restart", { method: "POST" });
    const res = await handleJobRestart(req, "restart-2", root);
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(409);
    expect(body["code"]).toBe("job_running");
  });

  it("proceeds when PID is missing and no tasks are running", async () => {
    const root = await makeTempRoot();
    initPATHS(root);

    // No PID file, stale state=running but tasks are done/pending
    await setupJob(root, "restart-3", {
      id: "restart-3",
      state: "running",
      current: "research",
      currentStage: "prompt",
      tasks: {
        research: { state: "done", currentStage: null },
        analysis: { state: "pending", currentStage: null },
      },
      files: { artifacts: [], logs: [], tmp: [] },
    });

    mockRunnerSpawn();

    const req = new Request("http://localhost/api/jobs/restart-3/restart", { method: "POST" });
    const res = await handleJobRestart(req, "restart-3", root);
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(202);
    expect(body["ok"]).toBe(true);
    expect(body["mode"]).toBe("clean-slate");
  });
});

describe("handleTaskStart", () => {
  it("returns 404 JOB_NOT_FOUND when job exists in neither current/ nor complete/", async () => {
    const root = await makeTempRoot();
    initPATHS(root);

    const req = new Request("http://localhost/api/jobs/missing/tasks/research/start", { method: "POST" });
    const res = await handleTaskStart(req, "missing", "research", root);
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(404);
    expect(body["code"]).toBe("JOB_NOT_FOUND");
  });

  it("returns 409 unsupported_lifecycle when job exists only in complete/, leaving job directory in place", async () => {
    const root = await makeTempRoot();
    initPATHS(root);

    const completeDir = path.join(root, "pipeline-data", "complete", "task-start-complete");
    await mkdir(completeDir, { recursive: true });
    await writeFile(path.join(completeDir, "tasks-status.json"), JSON.stringify({
      id: "task-start-complete",
      state: "complete",
      current: null,
      currentStage: null,
      tasks: {
        research: { state: "done", currentStage: null },
      },
      files: { artifacts: [], logs: [], tmp: [] },
    }));

    const req = new Request("http://localhost/api/jobs/task-start-complete/tasks/research/start", { method: "POST" });
    const res = await handleTaskStart(req, "task-start-complete", "research", root);
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(409);
    expect(body["code"]).toBe("unsupported_lifecycle");

    const stillThere = await Bun.file(path.join(completeDir, "tasks-status.json")).exists();
    expect(stillThere).toBe(true);

    const movedToCurrent = await Bun.file(path.join(root, "pipeline-data", "current", "task-start-complete", "tasks-status.json")).exists();
    expect(movedToCurrent).toBe(false);
  });

  it("returns 409 job_running when runner.pid points to a live process", async () => {
    const root = await makeTempRoot();
    initPATHS(root);

    const proc = spawnSleeper();

    await setupJob(root, "task-start-live", {
      id: "task-start-live",
      state: "running",
      current: "research",
      currentStage: "prompt",
      tasks: {
        research: { state: "running", currentStage: "prompt" },
      },
      files: { artifacts: [], logs: [], tmp: [] },
    }, proc.pid);

    const req = new Request("http://localhost/api/jobs/task-start-live/tasks/research/start", { method: "POST" });
    const res = await handleTaskStart(req, "task-start-live", "research", root);
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(409);
    expect(body["code"]).toBe("job_running");
  });

  it("returns 409 job_running when snapshot has a task in \"running\" state and PID is dead", async () => {
    const root = await makeTempRoot();
    initPATHS(root);

    await setupJob(root, "task-start-stale", {
      id: "task-start-stale",
      state: "running",
      current: "research",
      currentStage: "prompt",
      tasks: {
        research: { state: "running", currentStage: "prompt" },
        analysis: { state: "pending", currentStage: null },
      },
      files: { artifacts: [], logs: [], tmp: [] },
    }, 999999);

    const req = new Request("http://localhost/api/jobs/task-start-stale/tasks/analysis/start", { method: "POST" });
    const res = await handleTaskStart(req, "task-start-stale", "analysis", root);
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(409);
    expect(body["code"]).toBe("job_running");
  });

  it("returns 404 task_not_found for an unknown taskId", async () => {
    const root = await makeTempRoot();
    initPATHS(root);

    await setupJob(root, "task-start-unknown", {
      id: "task-start-unknown",
      state: "pending",
      current: null,
      currentStage: null,
      tasks: {
        research: { state: "done", currentStage: null },
        analysis: { state: "pending", currentStage: null },
      },
      files: { artifacts: [], logs: [], tmp: [] },
    });

    const req = new Request("http://localhost/api/jobs/task-start-unknown/tasks/synthesis/start", { method: "POST" });
    const res = await handleTaskStart(req, "task-start-unknown", "synthesis", root);
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(404);
    expect(body["code"]).toBe("task_not_found");
  });

  it("returns 422 task_not_pending when target task is \"done\"", async () => {
    const root = await makeTempRoot();
    initPATHS(root);

    await setupJob(root, "task-start-done", {
      id: "task-start-done",
      state: "pending",
      current: null,
      currentStage: null,
      tasks: {
        research: { state: "done", currentStage: null },
        analysis: { state: "pending", currentStage: null },
      },
      files: { artifacts: [], logs: [], tmp: [] },
    });

    const req = new Request("http://localhost/api/jobs/task-start-done/tasks/research/start", { method: "POST" });
    const res = await handleTaskStart(req, "task-start-done", "research", root);
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(422);
    expect(body["code"]).toBe("task_not_pending");
  });

  it("returns 202 and spawns runner when target task is pending and dependencies are done", async () => {
    const root = await makeTempRoot();
    initPATHS(root);
    await setupPipelineConfig(root, "task-start-ok-pipeline", ["research", "analysis"]);
    const spawnSpy = mockRunnerSpawn(12345);

    const jobDir = await setupJob(root, "task-start-ok", {
      id: "task-start-ok",
      pipeline: "task-start-ok-pipeline",
      state: "pending",
      current: null,
      currentStage: null,
      tasks: {
        analysis: { state: "pending", currentStage: null },
        research: { state: "done", currentStage: null },
      },
      files: { artifacts: [], logs: [], tmp: [] },
    });

    const statusPath = path.join(jobDir, "tasks-status.json");
    const snapshotBefore = await Bun.file(statusPath).text();

    const req = new Request("http://localhost/api/jobs/task-start-ok/tasks/analysis/start", { method: "POST" });
    const originalRunSingleTask = process.env["PO_RUN_SINGLE_TASK"];
    process.env["PO_RUN_SINGLE_TASK"] = "true";
    let res: Response;
    try {
      res = await handleTaskStart(req, "task-start-ok", "analysis", root);
    } finally {
      if (originalRunSingleTask === undefined) {
        delete process.env["PO_RUN_SINGLE_TASK"];
      } else {
        process.env["PO_RUN_SINGLE_TASK"] = originalRunSingleTask;
      }
    }
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(202);
    expect(body).toEqual({
      ok: true,
      jobId: "task-start-ok",
      taskId: "analysis",
      action: "start",
      lifecycle: "current",
      spawned: true,
    });

    const snapshotAfter = await Bun.file(statusPath).text();
    expect(snapshotAfter).toBe(snapshotBefore);

    expect(spawnSpy).toHaveBeenCalledTimes(1);
    const spawnOptions = spawnSpy.mock.calls[0]![0] as unknown as {
      cmd: string[];
      env: Record<string, string | undefined>;
    };
    expect(spawnOptions.cmd[0]).toBe("bun");
    expect(spawnOptions.cmd[1]).toBe("run");
    expect(spawnOptions.cmd[2]).toContain("pipeline-runner.ts");
    expect(spawnOptions.cmd[3]).toBe("task-start-ok");
    expect(spawnOptions.env["PO_ROOT"]).toBe(root);
    expect(spawnOptions.env["PO_START_FROM_TASK"]).toBe("analysis");
    expect(spawnOptions.env["PO_RUN_SINGLE_TASK"]).toBeUndefined();
    await expect(Bun.file(path.join(jobDir, "runner.pid")).text()).resolves.toBe("12345\n");
  });

  it("returns 409 job_running on an immediate second start after writing runner.pid", async () => {
    const root = await makeTempRoot();
    initPATHS(root);
    await setupPipelineConfig(root, "task-start-duplicate-pipeline", ["research", "analysis"]);
    const spawnSpy = mockRunnerSpawn(process.pid);

    await setupJob(root, "task-start-duplicate", {
      id: "task-start-duplicate",
      pipeline: "task-start-duplicate-pipeline",
      state: "pending",
      current: null,
      currentStage: null,
      tasks: {
        research: { state: "done", currentStage: null },
        analysis: { state: "pending", currentStage: null },
      },
      files: { artifacts: [], logs: [], tmp: [] },
    });

    const firstReq = new Request("http://localhost/api/jobs/task-start-duplicate/tasks/analysis/start", { method: "POST" });
    const firstRes = await handleTaskStart(firstReq, "task-start-duplicate", "analysis", root);
    expect(firstRes.status).toBe(202);

    const secondReq = new Request("http://localhost/api/jobs/task-start-duplicate/tasks/analysis/start", { method: "POST" });
    const secondRes = await handleTaskStart(secondReq, "task-start-duplicate", "analysis", root);
    const secondBody = await secondRes.json() as Record<string, unknown>;

    expect(secondRes.status).toBe(409);
    expect(secondBody["code"]).toBe("job_running");
    expect(spawnSpy).toHaveBeenCalledTimes(1);
  });

  it("returns 412 dependencies_not_satisfied when an earlier task is \"pending\"", async () => {
    const root = await makeTempRoot();
    initPATHS(root);
    await setupPipelineConfig(root, "task-start-deps-pipeline", ["research", "analysis"]);

    await setupJob(root, "task-start-deps", {
      id: "task-start-deps",
      pipeline: "task-start-deps-pipeline",
      state: "pending",
      current: null,
      currentStage: null,
      tasks: {
        analysis: { state: "pending", currentStage: null },
        research: { state: "pending", currentStage: null },
      },
      files: { artifacts: [], logs: [], tmp: [] },
    });

    const req = new Request("http://localhost/api/jobs/task-start-deps/tasks/analysis/start", { method: "POST" });
    const res = await handleTaskStart(req, "task-start-deps", "analysis", root);
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(412);
    expect(body["code"]).toBe("dependencies_not_satisfied");
  });

  it("returns 412 dependencies_not_satisfied when an earlier task is \"failed\"", async () => {
    const root = await makeTempRoot();
    initPATHS(root);
    await setupPipelineConfig(root, "task-start-failed-deps-pipeline", ["research", "analysis"]);

    await setupJob(root, "task-start-failed-deps", {
      id: "task-start-failed-deps",
      pipeline: "task-start-failed-deps-pipeline",
      state: "failed",
      current: null,
      currentStage: null,
      tasks: {
        analysis: { state: "pending", currentStage: null },
        research: { state: "failed", currentStage: null },
      },
      files: { artifacts: [], logs: [], tmp: [] },
    });

    const req = new Request("http://localhost/api/jobs/task-start-failed-deps/tasks/analysis/start", { method: "POST" });
    const res = await handleTaskStart(req, "task-start-failed-deps", "analysis", root);
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(412);
    expect(body["code"]).toBe("dependencies_not_satisfied");
  });
});

describe("stop → restart integration", () => {
  it("stop moves running to pending, then restart proceeds without 409", async () => {
    const root = await makeTempRoot();
    initPATHS(root);

    const proc = spawnSleeper();
    const jobDir = await setupJob(root, "integ-1", {
      id: "integ-1",
      state: "running",
      current: "research",
      currentStage: "prompt",
      tasks: {
        research: { state: "running", currentStage: "prompt" },
        analysis: { state: "pending", currentStage: null },
      },
      files: { artifacts: [], logs: [], tmp: [] },
    }, proc.pid);

    // Stop the running job
    const stopReq = new Request("http://localhost/api/jobs/integ-1/stop", { method: "POST" });
    const stopRes = await handleJobStop(stopReq, "integ-1", root);
    expect(stopRes.status).toBe(202);

    // Verify status file reflects pending after stop
    const snapshot = await readJobStatus(jobDir);
    expect(snapshot!.state).toBe("pending");
    expect(snapshot!.tasks["research"]!.state).toBe("pending");

    // Restart should now succeed (no 409 deadlock)
    mockRunnerSpawn();
    const restartReq = new Request("http://localhost/api/jobs/integ-1/restart", { method: "POST" });
    const restartRes = await handleJobRestart(restartReq, "integ-1", root);
    const restartBody = await restartRes.json() as Record<string, unknown>;

    expect(restartRes.status).toBe(202);
    expect(restartBody["ok"]).toBe(true);
    expect(restartBody["mode"]).toBe("clean-slate");
  });

  it("restart proceeds when PID is stale and status says running but tasks are not", async () => {
    const root = await makeTempRoot();
    initPATHS(root);

    // Simulate a stale state: status file says running, PID is dead, but tasks are done/pending
    await setupJob(root, "integ-2", {
      id: "integ-2",
      state: "running",
      current: "research",
      currentStage: "prompt",
      tasks: {
        research: { state: "done", currentStage: null },
        analysis: { state: "pending", currentStage: null },
      },
      files: { artifacts: [], logs: [], tmp: [] },
    }, 999999);

    mockRunnerSpawn();

    const req = new Request("http://localhost/api/jobs/integ-2/restart", { method: "POST" });
    const res = await handleJobRestart(req, "integ-2", root);
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(202);
    expect(body["ok"]).toBe(true);
  });

  it("restart is blocked when PID is alive even after a prior stop attempt", async () => {
    const root = await makeTempRoot();
    initPATHS(root);

    const proc = spawnSleeper();

    // Write status as pending (as if stop ran) but keep a live PID file
    await setupJob(root, "integ-3", {
      id: "integ-3",
      state: "pending",
      current: null,
      currentStage: null,
      tasks: {
        research: { state: "pending", currentStage: null },
      },
      files: { artifacts: [], logs: [], tmp: [] },
    }, proc.pid);

    const req = new Request("http://localhost/api/jobs/integ-3/restart", { method: "POST" });
    const res = await handleJobRestart(req, "integ-3", root);
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(409);
    expect(body["code"]).toBe("job_running");
  });

  it("restart is blocked when task-derived state is running despite dead PID", async () => {
    const root = await makeTempRoot();
    initPATHS(root);

    // PID dead (999999), but a task is still marked as running
    await setupJob(root, "integ-4", {
      id: "integ-4",
      state: "running",
      current: "analysis",
      currentStage: "stage-1",
      tasks: {
        research: { state: "done", currentStage: null },
        analysis: { state: "running", currentStage: "stage-1" },
      },
      files: { artifacts: [], logs: [], tmp: [] },
    }, 999999);

    const req = new Request("http://localhost/api/jobs/integ-4/restart", { method: "POST" });
    const res = await handleJobRestart(req, "integ-4", root);
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(409);
    expect(body["code"]).toBe("job_running");
  });

  it("full cycle: stop clears running task, restart resets all tasks to pending", async () => {
    const root = await makeTempRoot();
    initPATHS(root);

    const proc = spawnSleeper();
    const jobDir = await setupJob(root, "integ-5", {
      id: "integ-5",
      state: "running",
      current: "analysis",
      currentStage: "stage-2",
      tasks: {
        research: { state: "done", currentStage: null },
        analysis: { state: "running", currentStage: "stage-2", attempts: 2 },
        synthesis: { state: "pending", currentStage: null },
      },
      files: { artifacts: [], logs: [], tmp: [] },
    }, proc.pid);

    // Stop
    const stopReq = new Request("http://localhost/api/jobs/integ-5/stop", { method: "POST" });
    const stopRes = await handleJobStop(stopReq, "integ-5", root);
    const stopBody = await stopRes.json() as Record<string, unknown>;
    expect(stopRes.status).toBe(202);
    expect(stopBody["resetTask"]).toBe("analysis");

    // Verify intermediate state after stop
    const afterStop = await readJobStatus(jobDir);
    expect(afterStop!.state).toBe("pending");
    expect(afterStop!.tasks["research"]!.state).toBe("done");
    expect(afterStop!.tasks["analysis"]!.state).toBe("pending");
    expect(afterStop!.tasks["analysis"]!.attempts).toBe(0);
    expect(afterStop!.tasks["synthesis"]!.state).toBe("pending");

    // Restart with clean-slate resets everything
    mockRunnerSpawn();
    const restartReq = new Request("http://localhost/api/jobs/integ-5/restart", { method: "POST" });
    const restartRes = await handleJobRestart(restartReq, "integ-5", root);
    const restartBody = await restartRes.json() as Record<string, unknown>;
    expect(restartRes.status).toBe(202);
    expect(restartBody["mode"]).toBe("clean-slate");

    // Verify final state: all tasks reset
    const afterRestart = await readJobStatus(jobDir);
    expect(afterRestart!.state).toBe("pending");
    expect(afterRestart!.tasks["research"]!.state).toBe("pending");
    expect(afterRestart!.tasks["analysis"]!.state).toBe("pending");
    expect(afterRestart!.tasks["synthesis"]!.state).toBe("pending");
  });
});
