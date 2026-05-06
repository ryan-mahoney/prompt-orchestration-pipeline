import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { handleConcurrencyStatus } from "../endpoints/concurrency-endpoint";
import { resetConfig } from "../../../core/config";
import {
  getConcurrencyRuntimePaths,
  type JobSlotLease,
} from "../../../core/job-concurrency";

const tempRoots: string[] = [];

async function makeTempRoot(): Promise<string> {
  const root = await Bun.$`mktemp -d ${path.join(os.tmpdir(), "concurrency-endpoint-XXXXXX")}`.text();
  const trimmed = root.trim();
  tempRoots.push(trimmed);
  return trimmed;
}

function setMaxConcurrentJobs(value: number): void {
  process.env["PO_MAX_RUNNING_JOBS"] = String(value);
  resetConfig();
}

async function writeLeaseFile(root: string, jobId: string, lease: JobSlotLease): Promise<void> {
  const { runningJobsDir } = getConcurrencyRuntimePaths(path.join(root, "pipeline-data"));
  await mkdir(runningJobsDir, { recursive: true });
  await writeFile(path.join(runningJobsDir, `${jobId}.json`), JSON.stringify(lease));
}

async function writeRawLeaseFile(root: string, fileName: string, contents: string): Promise<void> {
  const { runningJobsDir } = getConcurrencyRuntimePaths(path.join(root, "pipeline-data"));
  await mkdir(runningJobsDir, { recursive: true });
  await writeFile(path.join(runningJobsDir, fileName), contents);
}

async function writeCurrentJob(root: string, jobId: string): Promise<void> {
  await mkdir(path.join(root, "pipeline-data", "current", jobId), { recursive: true });
}

async function writePendingSeed(root: string, jobId: string, seed: Record<string, unknown>): Promise<void> {
  const pendingDir = path.join(root, "pipeline-data", "pending");
  await mkdir(pendingDir, { recursive: true });
  await writeFile(path.join(pendingDir, `${jobId}-seed.json`), JSON.stringify(seed));
}

afterEach(async () => {
  delete process.env["PO_MAX_RUNNING_JOBS"];
  resetConfig();
  await Promise.all(tempRoots.splice(0).map((root) => Bun.$`rm -rf ${root}`));
});

describe("handleConcurrencyStatus", () => {
  it("returns 200 with application/json content type", async () => {
    const root = await makeTempRoot();
    setMaxConcurrentJobs(3);

    const res = await handleConcurrencyStatus(root);

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/json");
  });

  it("reports an empty state when no leases or seeds exist", async () => {
    const root = await makeTempRoot();
    setMaxConcurrentJobs(4);

    const res = await handleConcurrencyStatus(root);
    const body = await res.json() as Record<string, unknown>;

    expect(body).toEqual({
      ok: true,
      data: {
        limit: 4,
        runningCount: 0,
        availableSlots: 4,
        queuedCount: 0,
        activeJobs: [],
        queuedJobs: [],
        staleSlots: [],
      },
    });
  });

  it("lists active jobs without slotPath", async () => {
    const root = await makeTempRoot();
    setMaxConcurrentJobs(2);

    await writeCurrentJob(root, "job-active");
    const { runningJobsDir } = getConcurrencyRuntimePaths(path.join(root, "pipeline-data"));
    await writeLeaseFile(root, "job-active", {
      jobId: "job-active",
      pid: process.pid,
      acquiredAt: "2026-05-05T12:00:00.000Z",
      source: "orchestrator",
      slotPath: path.join(runningJobsDir, "job-active.json"),
    });

    const res = await handleConcurrencyStatus(root);
    const body = await res.json() as { ok: boolean; data: Record<string, unknown> };

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data["runningCount"]).toBe(1);
    expect(body.data["availableSlots"]).toBe(1);
    const activeJobs = body.data["activeJobs"] as Array<Record<string, unknown>>;
    expect(activeJobs).toHaveLength(1);
    expect(activeJobs[0]).toEqual({
      jobId: "job-active",
      pid: process.pid,
      acquiredAt: "2026-05-05T12:00:00.000Z",
      source: "orchestrator",
    });
    for (const entry of activeJobs) {
      expect(entry).not.toHaveProperty("slotPath");
    }
  });

  it("lists queued seeds with metadata", async () => {
    const root = await makeTempRoot();
    setMaxConcurrentJobs(1);

    await writePendingSeed(root, "queued-1", { name: "First Job", pipeline: "alpha" });
    await writePendingSeed(root, "queued-2", { name: "Second Job", pipeline: "beta" });

    const res = await handleConcurrencyStatus(root);
    const body = await res.json() as { ok: boolean; data: Record<string, unknown> };

    expect(res.status).toBe(200);
    expect(body.data["queuedCount"]).toBe(2);
    const queuedJobs = body.data["queuedJobs"] as Array<Record<string, unknown>>;
    expect(queuedJobs).toHaveLength(2);
    const ids = queuedJobs.map((entry) => entry["jobId"]);
    expect(ids).toContain("queued-1");
    expect(ids).toContain("queued-2");
    const first = queuedJobs.find((entry) => entry["jobId"] === "queued-1")!;
    expect(first["name"]).toBe("First Job");
    expect(first["pipeline"]).toBe("alpha");
    expect(typeof first["queuedAt"]).toBe("string");
    expect(first).not.toHaveProperty("seedPath");
  });

  it("reports stale slots without slotPath", async () => {
    const root = await makeTempRoot();
    setMaxConcurrentJobs(2);

    await writeRawLeaseFile(root, "stale-job.json", "{ this is not json");

    const res = await handleConcurrencyStatus(root);
    const body = await res.json() as { ok: boolean; data: Record<string, unknown> };

    const staleSlots = body.data["staleSlots"] as Array<Record<string, unknown>>;
    expect(staleSlots).toHaveLength(1);
    expect(staleSlots[0]).toEqual({
      jobId: "stale-job",
      reason: "invalid_json",
    });
    for (const entry of staleSlots) {
      expect(entry).not.toHaveProperty("slotPath");
    }

    const { runningJobsDir } = getConcurrencyRuntimePaths(path.join(root, "pipeline-data"));
    const stalePath = path.join(runningJobsDir, "stale-job.json");
    expect(await Bun.file(stalePath).exists()).toBe(false);
  });

  it("never exposes slotPath in activeJobs or staleSlots", async () => {
    const root = await makeTempRoot();
    setMaxConcurrentJobs(2);

    await writeCurrentJob(root, "job-active");
    const { runningJobsDir } = getConcurrencyRuntimePaths(path.join(root, "pipeline-data"));
    await writeLeaseFile(root, "job-active", {
      jobId: "job-active",
      pid: process.pid,
      acquiredAt: "2026-05-05T12:00:00.000Z",
      source: "orchestrator",
      slotPath: path.join(runningJobsDir, "job-active.json"),
    });
    await writeRawLeaseFile(root, "broken-job.json", "not-json");

    const res = await handleConcurrencyStatus(root);
    const raw = await res.text();

    expect(raw).not.toContain("slotPath");
  });
});
