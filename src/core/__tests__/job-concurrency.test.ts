import { describe, test, expect } from "bun:test";
import { mkdtemp, mkdir, writeFile, utimes, rm, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  getConcurrencyRuntimePaths,
  getJobConcurrencyStatus,
  listQueuedSeeds,
  pruneStaleJobSlots,
  releaseJobSlot,
  tryAcquireJobSlot,
  updateJobSlotPid,
  type JobSlotLease,
} from "../job-concurrency";
import { readFile } from "node:fs/promises";

describe("getConcurrencyRuntimePaths", () => {
  test("resolves runtime paths under <dataDir>/runtime", () => {
    const dataDir = "/tmp/pipeline-data";
    const paths = getConcurrencyRuntimePaths(dataDir);
    expect(paths.runtimeDir).toBe(join(dataDir, "runtime"));
    expect(paths.lockDir).toBe(join(dataDir, "runtime", "lock"));
    expect(paths.runningJobsDir).toBe(join(dataDir, "runtime", "running-jobs"));
  });

  test("works with relative dataDir", () => {
    const paths = getConcurrencyRuntimePaths("data");
    expect(paths.runtimeDir).toBe(join("data", "runtime"));
    expect(paths.lockDir).toBe(join("data", "runtime", "lock"));
    expect(paths.runningJobsDir).toBe(join("data", "runtime", "running-jobs"));
  });
});

async function writeSeed(
  pendingDir: string,
  jobId: string,
  body: unknown,
  mtimeSec: number,
): Promise<string> {
  const filePath = join(pendingDir, `${jobId}-seed.json`);
  await writeFile(filePath, typeof body === "string" ? body : JSON.stringify(body));
  await utimes(filePath, mtimeSec, mtimeSec);
  return filePath;
}

describe("listQueuedSeeds", () => {
  test("returns [] when pending dir does not exist", async () => {
    const dir = await mkdtemp(join(tmpdir(), "queued-seeds-"));
    try {
      expect(await listQueuedSeeds(dir)).toEqual([]);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("returns [] when pending dir is empty", async () => {
    const dir = await mkdtemp(join(tmpdir(), "queued-seeds-"));
    await mkdir(join(dir, "pending"), { recursive: true });
    try {
      expect(await listQueuedSeeds(dir)).toEqual([]);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("extracts name and pipeline from valid seed JSON", async () => {
    const dir = await mkdtemp(join(tmpdir(), "queued-seeds-"));
    const pendingDir = join(dir, "pending");
    await mkdir(pendingDir, { recursive: true });
    const seedPath = await writeSeed(
      pendingDir,
      "job-123",
      { name: "demo", pipeline: "alpha", extra: 1 },
      1700000000,
    );
    try {
      const result = await listQueuedSeeds(dir);
      expect(result).toEqual([
        {
          jobId: "job-123",
          seedPath,
          queuedAt: new Date(1700000000 * 1000).toISOString(),
          name: "demo",
          pipeline: "alpha",
        },
      ]);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("returns name and pipeline as null on invalid JSON without throwing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "queued-seeds-"));
    const pendingDir = join(dir, "pending");
    await mkdir(pendingDir, { recursive: true });
    await writeSeed(pendingDir, "job-bad", "not json {", 1700000100);
    try {
      const result = await listQueuedSeeds(dir);
      expect(result).toHaveLength(1);
      expect(result[0]!.jobId).toBe("job-bad");
      expect(result[0]!.name).toBeNull();
      expect(result[0]!.pipeline).toBeNull();
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("sorts by mtime ascending, then jobId ascending as tiebreaker", async () => {
    const dir = await mkdtemp(join(tmpdir(), "queued-seeds-"));
    const pendingDir = join(dir, "pending");
    await mkdir(pendingDir, { recursive: true });
    await writeSeed(pendingDir, "job-c", { pipeline: "p" }, 1700000300);
    await writeSeed(pendingDir, "job-b", { pipeline: "p" }, 1700000100);
    await writeSeed(pendingDir, "job-a", { pipeline: "p" }, 1700000100);
    await writeSeed(pendingDir, "job-d", { pipeline: "p" }, 1700000200);
    try {
      const result = await listQueuedSeeds(dir);
      expect(result.map((s) => s.jobId)).toEqual(["job-a", "job-b", "job-d", "job-c"]);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("ignores files that do not match the seed filename pattern", async () => {
    const dir = await mkdtemp(join(tmpdir(), "queued-seeds-"));
    const pendingDir = join(dir, "pending");
    await mkdir(pendingDir, { recursive: true });
    await writeFile(join(pendingDir, "seed.json"), "{}");
    await writeFile(join(pendingDir, "random.txt"), "noise");
    await writeFile(join(pendingDir, "job-x-other.json"), "{}");
    await writeSeed(pendingDir, "job-only", { pipeline: "p" }, 1700000050);
    try {
      const result = await listQueuedSeeds(dir);
      expect(result.map((s) => s.jobId)).toEqual(["job-only"]);
    } finally {
      await rm(dir, { recursive: true });
    }
  });
});

async function writeLease(
  runningJobsDir: string,
  jobId: string,
  body: Partial<JobSlotLease> | string,
): Promise<string> {
  const slotPath = join(runningJobsDir, `${jobId}.json`);
  await writeFile(slotPath, typeof body === "string" ? body : JSON.stringify(body));
  return slotPath;
}

function getDeadPid(): number {
  // Spawn a synchronous child that exits immediately. spawnSync only returns
  // after the child has exited, so the captured PID is guaranteed dead by then.
  const result = spawnSync(process.execPath, ["-e", ""]);
  if (result.pid === undefined || result.status === null) {
    throw new Error("failed to spawn child for dead-pid test");
  }
  return result.pid;
}

describe("pruneStaleJobSlots", () => {
  test("returns [] when runningJobsDir does not exist", async () => {
    const dir = await mkdtemp(join(tmpdir(), "prune-stale-"));
    try {
      expect(await pruneStaleJobSlots(dir, 1000)).toEqual([]);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("returns [] when runningJobsDir is empty", async () => {
    const dir = await mkdtemp(join(tmpdir(), "prune-stale-"));
    const { runningJobsDir } = getConcurrencyRuntimePaths(dir);
    await mkdir(runningJobsDir, { recursive: true });
    try {
      expect(await pruneStaleJobSlots(dir, 1000)).toEqual([]);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("removes and reports lease with malformed JSON", async () => {
    const dir = await mkdtemp(join(tmpdir(), "prune-stale-"));
    const { runningJobsDir } = getConcurrencyRuntimePaths(dir);
    await mkdir(runningJobsDir, { recursive: true });
    const slotPath = await writeLease(runningJobsDir, "job-bad", "not json {");
    try {
      const result = await pruneStaleJobSlots(dir, 1000);
      expect(result).toEqual([
        { jobId: "job-bad", slotPath, reason: "invalid_json" },
      ]);
      expect(existsSync(slotPath)).toBe(false);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("removes and reports lease whose current/<jobId> directory is missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "prune-stale-"));
    const { runningJobsDir } = getConcurrencyRuntimePaths(dir);
    await mkdir(runningJobsDir, { recursive: true });
    const slotPath = await writeLease(runningJobsDir, "job-missing", {
      jobId: "job-missing",
      pid: process.pid,
      acquiredAt: new Date().toISOString(),
      source: "orchestrator",
      slotPath: join(runningJobsDir, "job-missing.json"),
    });
    try {
      const result = await pruneStaleJobSlots(dir, 1000);
      expect(result).toEqual([
        { jobId: "job-missing", slotPath, reason: "missing_current_job" },
      ]);
      expect(existsSync(slotPath)).toBe(false);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("removes and reports lease with a dead PID", async () => {
    const dir = await mkdtemp(join(tmpdir(), "prune-stale-"));
    const { runningJobsDir } = getConcurrencyRuntimePaths(dir);
    await mkdir(runningJobsDir, { recursive: true });
    await mkdir(join(dir, "current", "job-dead"), { recursive: true });
    const deadPid = getDeadPid();
    const slotPath = await writeLease(runningJobsDir, "job-dead", {
      jobId: "job-dead",
      pid: deadPid,
      acquiredAt: new Date().toISOString(),
      source: "orchestrator",
      slotPath: join(runningJobsDir, "job-dead.json"),
    });
    try {
      const result = await pruneStaleJobSlots(dir, 1000);
      expect(result).toEqual([
        { jobId: "job-dead", slotPath, reason: "dead_pid" },
      ]);
      expect(existsSync(slotPath)).toBe(false);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("removes and reports lease with null pid older than lockTimeoutMs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "prune-stale-"));
    const { runningJobsDir } = getConcurrencyRuntimePaths(dir);
    await mkdir(runningJobsDir, { recursive: true });
    await mkdir(join(dir, "current", "job-stale-pidless"), { recursive: true });
    const slotPath = await writeLease(runningJobsDir, "job-stale-pidless", {
      jobId: "job-stale-pidless",
      pid: null,
      acquiredAt: new Date(Date.now() - 60_000).toISOString(),
      source: "orchestrator",
      slotPath: join(runningJobsDir, "job-stale-pidless.json"),
    });
    try {
      const result = await pruneStaleJobSlots(dir, 1000);
      expect(result).toEqual([
        { jobId: "job-stale-pidless", slotPath, reason: "missing_pid" },
      ]);
      expect(existsSync(slotPath)).toBe(false);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("does not prune a fresh lease with null pid younger than lockTimeoutMs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "prune-stale-"));
    const { runningJobsDir } = getConcurrencyRuntimePaths(dir);
    await mkdir(runningJobsDir, { recursive: true });
    await mkdir(join(dir, "current", "job-fresh"), { recursive: true });
    const slotPath = await writeLease(runningJobsDir, "job-fresh", {
      jobId: "job-fresh",
      pid: null,
      acquiredAt: new Date().toISOString(),
      source: "orchestrator",
      slotPath: join(runningJobsDir, "job-fresh.json"),
    });
    try {
      const result = await pruneStaleJobSlots(dir, 60_000);
      expect(result).toEqual([]);
      expect(existsSync(slotPath)).toBe(true);
      expect(await readdir(runningJobsDir)).toEqual(["job-fresh.json"]);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("keeps lease with live pid and present current dir", async () => {
    const dir = await mkdtemp(join(tmpdir(), "prune-stale-"));
    const { runningJobsDir } = getConcurrencyRuntimePaths(dir);
    await mkdir(runningJobsDir, { recursive: true });
    await mkdir(join(dir, "current", "job-live"), { recursive: true });
    const slotPath = await writeLease(runningJobsDir, "job-live", {
      jobId: "job-live",
      pid: process.pid,
      acquiredAt: new Date().toISOString(),
      source: "orchestrator",
      slotPath: join(runningJobsDir, "job-live.json"),
    });
    try {
      const result = await pruneStaleJobSlots(dir, 1000);
      expect(result).toEqual([]);
      expect(existsSync(slotPath)).toBe(true);
    } finally {
      await rm(dir, { recursive: true });
    }
  });
});

async function setupJobsDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  const { runningJobsDir } = getConcurrencyRuntimePaths(dir);
  await mkdir(runningJobsDir, { recursive: true });
  await mkdir(join(dir, "current"), { recursive: true });
  return dir;
}

async function makeCurrent(dir: string, jobId: string): Promise<void> {
  await mkdir(join(dir, "current", jobId), { recursive: true });
}

describe("tryAcquireJobSlot", () => {
  test("succeeds up to maxConcurrentJobs and rejects the next attempt", async () => {
    const dir = await setupJobsDir("acquire-");
    try {
      for (const jobId of ["a", "b"]) {
        await makeCurrent(dir, jobId);
        const r = await tryAcquireJobSlot({
          dataDir: dir,
          jobId,
          maxConcurrentJobs: 2,
          source: "orchestrator",
          pid: process.pid,
        });
        expect(r.ok).toBe(true);
      }
      await makeCurrent(dir, "c");
      const overflow = await tryAcquireJobSlot({
        dataDir: dir,
        jobId: "c",
        maxConcurrentJobs: 2,
        source: "orchestrator",
      });
      expect(overflow.ok).toBe(false);
      if (!overflow.ok) {
        expect(overflow.reason).toBe("limit_reached");
        expect(overflow.status.runningCount).toBe(2);
        expect(overflow.status.availableSlots).toBe(0);
      }
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("releaseJobSlot frees capacity", async () => {
    const dir = await setupJobsDir("release-cap-");
    try {
      await makeCurrent(dir, "a");
      await makeCurrent(dir, "b");
      const r1 = await tryAcquireJobSlot({
        dataDir: dir,
        jobId: "a",
        maxConcurrentJobs: 1,
        source: "orchestrator",
        pid: process.pid,
      });
      expect(r1.ok).toBe(true);
      const r2 = await tryAcquireJobSlot({
        dataDir: dir,
        jobId: "b",
        maxConcurrentJobs: 1,
        source: "orchestrator",
      });
      expect(r2.ok).toBe(false);
      await releaseJobSlot(dir, "a");
      const r3 = await tryAcquireJobSlot({
        dataDir: dir,
        jobId: "b",
        maxConcurrentJobs: 1,
        source: "orchestrator",
        pid: process.pid,
      });
      expect(r3.ok).toBe(true);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("concurrent acquisition of the last slot yields exactly one winner", async () => {
    const dir = await setupJobsDir("acquire-race-");
    try {
      const limit = 3;
      const total = 12;
      const jobIds = Array.from({ length: total }, (_, i) => `job-${i}`);
      for (const id of jobIds) await makeCurrent(dir, id);
      const results = await Promise.all(
        jobIds.map((jobId) =>
          tryAcquireJobSlot({
            dataDir: dir,
            jobId,
            maxConcurrentJobs: limit,
            source: "orchestrator",
            pid: process.pid,
          }),
        ),
      );
      const winners = results.filter((r) => r.ok).length;
      const losers = results.filter((r) => !r.ok).length;
      expect(winners).toBe(limit);
      expect(losers).toBe(total - limit);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("returns already_held when a slot is already held for the same jobId", async () => {
    const dir = await setupJobsDir("acquire-dup-");
    try {
      await makeCurrent(dir, "a");
      await tryAcquireJobSlot({
        dataDir: dir,
        jobId: "a",
        maxConcurrentJobs: 5,
        source: "orchestrator",
        pid: process.pid,
      });
      const duplicate = await tryAcquireJobSlot({
        dataDir: dir,
        jobId: "a",
        maxConcurrentJobs: 5,
        source: "orchestrator",
      });
      expect(duplicate.ok).toBe(false);
      if (!duplicate.ok) {
        expect(duplicate.reason).toBe("already_held");
        expect(duplicate.status.runningCount).toBe(1);
      }
    } finally {
      await rm(dir, { recursive: true });
    }
  });
});

describe("updateJobSlotPid", () => {
  test("updates the pid on an existing lease", async () => {
    const dir = await setupJobsDir("update-pid-");
    try {
      await makeCurrent(dir, "a");
      await tryAcquireJobSlot({
        dataDir: dir,
        jobId: "a",
        maxConcurrentJobs: 1,
        source: "orchestrator",
      });
      await updateJobSlotPid(dir, "a", 12345);
      const { runningJobsDir } = getConcurrencyRuntimePaths(dir);
      const raw = await readFile(join(runningJobsDir, "a.json"), "utf-8");
      const lease = JSON.parse(raw) as JobSlotLease;
      expect(lease.pid).toBe(12345);
      expect(lease.jobId).toBe("a");
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("throws when no lease exists for the jobId", async () => {
    const dir = await setupJobsDir("update-pid-missing-");
    try {
      await expect(updateJobSlotPid(dir, "missing", 1)).rejects.toThrow(
        /no lease found for job missing/,
      );
    } finally {
      await rm(dir, { recursive: true });
    }
  });
});

describe("releaseJobSlot", () => {
  test("is idempotent when called on a non-existent lease", async () => {
    const dir = await setupJobsDir("release-idempotent-");
    try {
      await releaseJobSlot(dir, "ghost");
      await releaseJobSlot(dir, "ghost");
    } finally {
      await rm(dir, { recursive: true });
    }
  });
});

describe("getJobConcurrencyStatus", () => {
  test("returns counts including queued seeds and stale slots", async () => {
    const dir = await setupJobsDir("status-");
    const { runningJobsDir } = getConcurrencyRuntimePaths(dir);
    const pendingDir = join(dir, "pending");
    await mkdir(pendingDir, { recursive: true });
    try {
      await makeCurrent(dir, "live");
      await tryAcquireJobSlot({
        dataDir: dir,
        jobId: "live",
        maxConcurrentJobs: 5,
        source: "orchestrator",
        pid: process.pid,
      });
      await writeLease(runningJobsDir, "broken", "not json {");
      await writeSeed(pendingDir, "queued-1", { name: "n", pipeline: "p" }, 1700000000);
      await writeSeed(pendingDir, "queued-2", { name: "m", pipeline: "p" }, 1700000100);

      const status = await getJobConcurrencyStatus(dir, 5, 1000);
      expect(status.limit).toBe(5);
      expect(status.runningCount).toBe(1);
      expect(status.availableSlots).toBe(4);
      expect(status.queuedCount).toBe(2);
      expect(status.activeJobs.map((l) => l.jobId)).toEqual(["live"]);
      expect(status.queuedJobs.map((q) => q.jobId)).toEqual(["queued-1", "queued-2"]);
      expect(status.staleSlots).toEqual([
        {
          jobId: "broken",
          slotPath: join(runningJobsDir, "broken.json"),
          reason: "invalid_json",
        },
      ]);
      expect(existsSync(join(runningJobsDir, "broken.json"))).toBe(false);
    } finally {
      await rm(dir, { recursive: true });
    }
  });
});
