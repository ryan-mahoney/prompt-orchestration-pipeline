import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Subprocess } from "bun";

import { afterEach, describe, expect, it } from "vitest";

import { initPATHS, resetPATHS } from "../config-bridge-node";
import { handleJobStop } from "../endpoints/job-control-endpoints";
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
    expect(snapshot!.current).toBeNull();
    expect(snapshot!.currentStage).toBeNull();
    expect(snapshot!.tasks["research"]!.state).toBe("pending");
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
    expect(snapshot!.current).toBeNull();
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
