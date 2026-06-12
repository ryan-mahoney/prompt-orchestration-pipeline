import { readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Subprocess } from "bun";

import { afterEach, describe, expect, it, vi } from "vitest";

import { initPATHS, resetPATHS } from "../config-bridge-node";
import { handleGateDecision } from "../endpoints/gate-endpoints";
import { resetConfig } from "../../../core/config";
import { tryAcquireJobSlot } from "../../../core/job-concurrency";
import { readJobStatus, type StatusSnapshot } from "../../../core/status-writer";

const tempRoots: string[] = [];

async function makeTempRoot(): Promise<string> {
  const root = await Bun.$`mktemp -d ${path.join(os.tmpdir(), "gate-endpoints-XXXXXX")}`.text();
  const trimmed = root.trim();
  tempRoots.push(trimmed);
  return trimmed;
}

function makeSnapshot(overrides: Partial<StatusSnapshot> = {}): StatusSnapshot {
  return {
    id: "gate-job",
    state: "waiting",
    current: "review",
    currentStage: null,
    lastUpdated: "2026-04-01T10:00:00.000Z",
    tasks: {
      plan: { state: "done" },
      implement: { state: "pending" },
    },
    files: { artifacts: [], logs: [], tmp: [] },
    gate: {
      afterTask: "plan",
      message: "Review the plan",
      requestedAt: "2026-04-01T10:00:00.000Z",
    },
    ...overrides,
  };
}

async function setupJob(
  root: string,
  jobId: string,
  status: StatusSnapshot,
  pid?: number,
): Promise<string> {
  const jobDir = path.join(root, "pipeline-data", "current", jobId);
  await mkdir(jobDir, { recursive: true });
  await writeFile(path.join(jobDir, "tasks-status.json"), JSON.stringify({ ...status, id: jobId }));
  if (pid !== undefined) {
    await writeFile(path.join(jobDir, "runner.pid"), `${pid}\n`);
  }
  return jobDir;
}

function mockRunnerSpawn(pid = 515151) {
  const proc = {
    pid,
    unref: vi.fn(),
    kill: vi.fn(),
  } as unknown as Subprocess;
  return vi.spyOn(Bun, "spawn").mockReturnValue(proc);
}

function gateRequest(jobId: string, body: unknown): Request {
  return new Request(`http://localhost/api/jobs/${jobId}/gate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

afterEach(async () => {
  vi.restoreAllMocks();
  resetPATHS();
  resetConfig();
  await Promise.all(tempRoots.splice(0).map((root) => Bun.$`rm -rf ${root}`));
});

describe("handleGateDecision", () => {
  it("approves a gate by clearing it, appending an event, spawning, and returning 202", async () => {
    const root = await makeTempRoot();
    initPATHS(root);
    const jobDir = await setupJob(root, "approve-job", makeSnapshot());

    let statusAtSpawn: Record<string, unknown> | null = null;
    const spawnSpy = mockRunnerSpawn();
    spawnSpy.mockImplementation((() => {
      statusAtSpawn = JSON.parse(readFileSync(path.join(jobDir, "tasks-status.json"), "utf8")) as Record<string, unknown>;
      return {
        pid: 515151,
        unref: vi.fn(),
        kill: vi.fn(),
      } as unknown as Subprocess;
    }) as unknown as typeof Bun.spawn);

    const res = await handleGateDecision("approve-job", gateRequest("approve-job", { action: "approve" }), root);
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(202);
    expect(body).toMatchObject({ ok: true, jobId: "approve-job", action: "approve", spawned: true });
    expect(spawnSpy).toHaveBeenCalledTimes(1);
    expect(statusAtSpawn).toMatchObject({ state: "pending", gate: null });

    const snapshot = await readJobStatus(jobDir);
    expect(snapshot!.state).toBe("pending");
    expect(snapshot!.gate).toBeNull();

    const events = (await readFile(path.join(jobDir, "events.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "gate_decided", action: "approve", afterTask: "plan" });
  });

  it("rejects a gate by failing the job, appending an event, and not spawning", async () => {
    const root = await makeTempRoot();
    initPATHS(root);
    const jobDir = await setupJob(root, "reject-job", makeSnapshot());
    const spawnSpy = vi.spyOn(Bun, "spawn");

    const res = await handleGateDecision(
      "reject-job",
      gateRequest("reject-job", { action: "reject", note: "needs another pass" }),
      root,
    );
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(202);
    expect(body).toMatchObject({ ok: true, jobId: "reject-job", action: "reject", spawned: false });
    expect(spawnSpy).not.toHaveBeenCalled();

    const snapshot = await readJobStatus(jobDir);
    expect(snapshot!.state).toBe("failed");
    expect(snapshot!.gate).toBeNull();
    expect(snapshot!["error"]).toEqual({ name: "GateRejected", message: "needs another pass" });

    const events = (await readFile(path.join(jobDir, "events.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "gate_decided", action: "reject", afterTask: "plan", note: "needs another pass" });
  });

  it("returns 409 when another gate decision already holds the job slot", async () => {
    const root = await makeTempRoot();
    initPATHS(root);
    await setupJob(root, "slot-held-job", makeSnapshot());
    const lease = await tryAcquireJobSlot({
      dataDir: path.join(root, "pipeline-data"),
      jobId: "slot-held-job",
      maxConcurrentJobs: 1,
      source: "gate",
    });
    expect(lease.ok).toBe(true);

    const res = await handleGateDecision("slot-held-job", gateRequest("slot-held-job", { action: "reject" }), root);
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(409);
    expect(body["code"]).toBe("job_running");
  });

  it("returns 409 when the job has no gate", async () => {
    const root = await makeTempRoot();
    initPATHS(root);
    await setupJob(root, "no-gate-job", makeSnapshot({ gate: null, state: "pending" }));

    const res = await handleGateDecision("no-gate-job", gateRequest("no-gate-job", { action: "approve" }), root);
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(409);
    expect(body["code"]).toBe("no_pending_gate");
  });

  it("returns 409 when runner.pid is live", async () => {
    const root = await makeTempRoot();
    initPATHS(root);
    await setupJob(root, "live-pid-job", makeSnapshot(), process.pid);

    const res = await handleGateDecision("live-pid-job", gateRequest("live-pid-job", { action: "approve" }), root);
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(409);
    expect(body["code"]).toBe("job_running");
  });

  it("returns 404 for an unknown or completed job", async () => {
    const root = await makeTempRoot();
    initPATHS(root);

    const res = await handleGateDecision("missing-job", gateRequest("missing-job", { action: "approve" }), root);
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(404);
    expect(body["code"]).toBe("JOB_NOT_FOUND");
  });

  it("returns 400 for a bad action", async () => {
    const root = await makeTempRoot();
    initPATHS(root);
    await setupJob(root, "bad-action-job", makeSnapshot());

    const res = await handleGateDecision("bad-action-job", gateRequest("bad-action-job", { action: "hold" }), root);
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(400);
    expect(body["code"]).toBe("BAD_REQUEST");
  });
});
