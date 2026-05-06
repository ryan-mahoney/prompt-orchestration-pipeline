import { describe, test, expect } from "bun:test";
import { mkdtemp, mkdir, writeFile, utimes, rm, readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { drainPendingQueue, handleChildExit } from "../orchestrator";
import {
  getConcurrencyRuntimePaths,
  getJobConcurrencyStatus,
} from "../job-concurrency";

async function setupDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  await mkdir(join(dir, "pending"), { recursive: true });
  await mkdir(join(dir, "current"), { recursive: true });
  const { runningJobsDir } = getConcurrencyRuntimePaths(dir);
  await mkdir(runningJobsDir, { recursive: true });
  return dir;
}

async function writeSeed(
  dir: string,
  jobId: string,
  body: unknown,
  mtimeSec: number,
): Promise<string> {
  const filePath = join(dir, "pending", `${jobId}-seed.json`);
  await writeFile(filePath, JSON.stringify(body));
  await utimes(filePath, mtimeSec, mtimeSec);
  return filePath;
}

function fakeSpawnRunner(jobIdToPid: Map<string, number>): (jobId: string) => Promise<{ pid: number }> {
  return async (jobId: string) => {
    const pid = process.pid;
    jobIdToPid.set(jobId, pid);
    return { pid };
  };
}

describe("drainPendingQueue", () => {
  test("with limit 2 and three seeds, promotes exactly two and one remains in pending", async () => {
    const dir = await setupDir("drain-limit2-");
    try {
      await writeSeed(dir, "job-a", { pipeline: "p" }, 1700000000);
      await writeSeed(dir, "job-b", { pipeline: "p" }, 1700000100);
      await writeSeed(dir, "job-c", { pipeline: "p" }, 1700000200);
      const pids = new Map<string, number>();
      const result = await drainPendingQueue({
        dataDir: dir,
        maxConcurrentJobs: 2,
        lockTimeoutMs: 1000,
        spawnRunner: fakeSpawnRunner(pids),
      });
      expect(result.promoted).toEqual(["job-a", "job-b"]);
      expect(result.remaining).toBe(1);
      expect(await readdir(join(dir, "pending"))).toEqual(["job-c-seed.json"]);
      expect(existsSync(join(dir, "current", "job-a", "seed.json"))).toBe(true);
      expect(existsSync(join(dir, "current", "job-b", "seed.json"))).toBe(true);
      expect(existsSync(join(dir, "current", "job-c"))).toBe(false);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("with limit 0, no seeds are promoted", async () => {
    const dir = await setupDir("drain-limit0-");
    try {
      await writeSeed(dir, "job-a", { pipeline: "p" }, 1700000000);
      await writeSeed(dir, "job-b", { pipeline: "p" }, 1700000100);
      const pids = new Map<string, number>();
      const result = await drainPendingQueue({
        dataDir: dir,
        maxConcurrentJobs: 0,
        lockTimeoutMs: 1000,
        spawnRunner: fakeSpawnRunner(pids),
      });
      expect(result.promoted).toEqual([]);
      expect(result.remaining).toBe(2);
      expect((await readdir(join(dir, "pending"))).sort()).toEqual([
        "job-a-seed.json",
        "job-b-seed.json",
      ]);
      const { runningJobsDir } = getConcurrencyRuntimePaths(dir);
      expect(await readdir(runningJobsDir)).toEqual([]);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("seed whose current/<jobId>/ already exists is not promoted, slot is released, seed remains in pending", async () => {
    const dir = await setupDir("drain-existing-");
    try {
      await writeSeed(dir, "job-existing", { pipeline: "p" }, 1700000000);
      await writeSeed(dir, "job-fresh", { pipeline: "p" }, 1700000100);
      await mkdir(join(dir, "current", "job-existing"), { recursive: true });
      const pids = new Map<string, number>();
      const result = await drainPendingQueue({
        dataDir: dir,
        maxConcurrentJobs: 5,
        lockTimeoutMs: 1000,
        spawnRunner: fakeSpawnRunner(pids),
      });
      expect(result.promoted).toEqual(["job-fresh"]);
      const status = await getJobConcurrencyStatus(dir, 5, 1000);
      expect(status.activeJobs.map((l) => l.jobId).sort()).toEqual(["job-fresh"]);
      expect(existsSync(join(dir, "pending", "job-existing-seed.json"))).toBe(true);
      const { runningJobsDir } = getConcurrencyRuntimePaths(dir);
      expect(existsSync(join(runningJobsDir, "job-existing.json"))).toBe(false);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("promotes seeds in deterministic order (mtime asc)", async () => {
    const dir = await setupDir("drain-order-");
    try {
      await writeSeed(dir, "job-c", { pipeline: "p" }, 1700000300);
      await writeSeed(dir, "job-a", { pipeline: "p" }, 1700000100);
      await writeSeed(dir, "job-b", { pipeline: "p" }, 1700000200);
      const pids = new Map<string, number>();
      const result = await drainPendingQueue({
        dataDir: dir,
        maxConcurrentJobs: 5,
        lockTimeoutMs: 1000,
        spawnRunner: fakeSpawnRunner(pids),
      });
      expect(result.promoted).toEqual(["job-a", "job-b", "job-c"]);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("if spawnRunner throws, the slot is released and the seed remains queued", async () => {
    const dir = await setupDir("drain-spawn-err-");
    try {
      await writeSeed(dir, "job-bad", { pipeline: "p" }, 1700000000);
      const failingSpawn = async (): Promise<{ pid: number }> => {
        throw new Error("boom");
      };
      const result = await drainPendingQueue({
        dataDir: dir,
        maxConcurrentJobs: 2,
        lockTimeoutMs: 1000,
        spawnRunner: failingSpawn,
      });
      expect(result.promoted).toEqual([]);
      const { runningJobsDir } = getConcurrencyRuntimePaths(dir);
      expect(existsSync(join(runningJobsDir, "job-bad.json"))).toBe(false);
      expect(existsSync(join(dir, "pending", "job-bad-seed.json"))).toBe(true);
      const status = await getJobConcurrencyStatus(dir, 2, 1000);
      expect(status.activeJobs).toEqual([]);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("repeated spawn failures move the seed to rejected", async () => {
    const dir = await setupDir("drain-spawn-reject-");
    try {
      await writeSeed(dir, "job-bad", { pipeline: "p" }, 1700000000);
      const failingSpawn = async (): Promise<{ pid: number }> => {
        throw new Error("boom");
      };

      for (let i = 0; i < 3; i++) {
        await drainPendingQueue({
          dataDir: dir,
          maxConcurrentJobs: 2,
          lockTimeoutMs: 1000,
          spawnRunner: failingSpawn,
        });
      }

      expect(existsSync(join(dir, "pending", "job-bad-seed.json"))).toBe(false);
      expect(existsSync(join(dir, "rejected", "job-bad", "seed.json"))).toBe(true);
      const rejection = JSON.parse(await readFile(join(dir, "rejected", "job-bad", "rejection.json"), "utf-8")) as Record<string, unknown>;
      expect(rejection["reason"]).toBe("spawn_failed");
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("repeated invalid seed reads move the seed to rejected", async () => {
    const dir = await setupDir("drain-invalid-reject-");
    try {
      const seedPath = join(dir, "pending", "job-invalid-seed.json");
      await writeFile(seedPath, "not json {");
      await utimes(seedPath, 1700000000, 1700000000);

      for (let i = 0; i < 3; i++) {
        await drainPendingQueue({
          dataDir: dir,
          maxConcurrentJobs: 2,
          lockTimeoutMs: 1000,
          spawnRunner: fakeSpawnRunner(new Map()),
        });
      }

      expect(existsSync(seedPath)).toBe(false);
      expect(existsSync(join(dir, "rejected", "job-invalid", "seed.json"))).toBe(true);
      const rejection = JSON.parse(await readFile(join(dir, "rejected", "job-invalid", "rejection.json"), "utf-8")) as Record<string, unknown>;
      expect(rejection["reason"]).toBe("invalid");
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("pid update failure kills the spawned runner and does not promote the job", async () => {
    const dir = await setupDir("drain-pid-update-");
    try {
      await writeSeed(dir, "job-pid-fail", { pipeline: "p" }, 1700000000);
      const { lockDir } = getConcurrencyRuntimePaths(dir);
      let killed = 0;
      const result = await drainPendingQueue({
        dataDir: dir,
        maxConcurrentJobs: 2,
        lockTimeoutMs: 10,
        spawnRunner: async () => {
          await mkdir(lockDir, { recursive: true });
          await writeFile(join(lockDir, "owner.json"), JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }));
          return { pid: process.pid, kill: () => { killed++; } };
        },
      });

      expect(result.promoted).toEqual([]);
      expect(killed).toBe(1);
      expect(existsSync(join(dir, "pending", "job-pid-fail-seed.json"))).toBe(true);
      await rm(lockDir, { recursive: true, force: true });
      const status = await getJobConcurrencyStatus(dir, 2, 1000);
      expect(status.activeJobs).toEqual([]);
    } finally {
      await rm(dir, { recursive: true });
    }
  });
});

describe("handleChildExit", () => {
  test("releases the exited job's slot and triggers a drain that promotes the next pending seed", async () => {
    const dir = await setupDir("exit-promotes-");
    try {
      await writeSeed(dir, "job-a", { pipeline: "p" }, 1700000000);
      await writeSeed(dir, "job-b", { pipeline: "p" }, 1700000100);
      const pids = new Map<string, number>();
      const spawn = fakeSpawnRunner(pids);

      const first = await drainPendingQueue({
        dataDir: dir,
        maxConcurrentJobs: 1,
        lockTimeoutMs: 1000,
        spawnRunner: spawn,
      });
      expect(first.promoted).toEqual(["job-a"]);
      expect(first.remaining).toBe(1);

      let drainResult: { promoted: string[]; remaining: number } | null = null;
      const triggerDrain = (): void => {
        void drainPendingQueue({
          dataDir: dir,
          maxConcurrentJobs: 1,
          lockTimeoutMs: 1000,
          spawnRunner: spawn,
        }).then((r) => {
          drainResult = r;
        });
      };

      await handleChildExit({ dataDir: dir, jobId: "job-a", triggerDrain });

      // Wait for the triggered drain to complete.
      while (drainResult === null) {
        await new Promise((r) => setTimeout(r, 5));
      }
      const finalResult = drainResult as { promoted: string[]; remaining: number };
      expect(finalResult.promoted).toEqual(["job-b"]);
      expect(existsSync(join(dir, "current", "job-b", "seed.json"))).toBe(true);
      const status = await getJobConcurrencyStatus(dir, 1, 1000);
      expect(status.activeJobs.map((l) => l.jobId)).toEqual(["job-b"]);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("handleChildExit on an already-released slot is a no-op", async () => {
    const dir = await setupDir("exit-idempotent-");
    try {
      let called = 0;
      await handleChildExit({
        dataDir: dir,
        jobId: "job-missing",
        triggerDrain: () => {
          called++;
        },
      });
      expect(called).toBe(1);
      const { runningJobsDir } = getConcurrencyRuntimePaths(dir);
      expect(existsSync(join(runningJobsDir, "job-missing.json"))).toBe(false);
    } finally {
      await rm(dir, { recursive: true });
    }
  });
});

describe("drainPendingQueue concurrency", () => {
  test("overlapping drain calls do not double-promote (limit 2, four seeds → exactly 2 promoted overall)", async () => {
    const dir = await setupDir("drain-overlap-");
    try {
      await writeSeed(dir, "job-a", { pipeline: "p" }, 1700000000);
      await writeSeed(dir, "job-b", { pipeline: "p" }, 1700000100);
      await writeSeed(dir, "job-c", { pipeline: "p" }, 1700000200);
      await writeSeed(dir, "job-d", { pipeline: "p" }, 1700000300);
      const pids = new Map<string, number>();
      const spawn = fakeSpawnRunner(pids);

      const results = await Promise.allSettled([
        drainPendingQueue({
          dataDir: dir,
          maxConcurrentJobs: 2,
          lockTimeoutMs: 1000,
          spawnRunner: spawn,
        }),
        drainPendingQueue({
          dataDir: dir,
          maxConcurrentJobs: 2,
          lockTimeoutMs: 1000,
          spawnRunner: spawn,
        }),
      ]);

      const promotedUnion = new Set<string>();
      for (const r of results) {
        if (r.status === "fulfilled") {
          for (const id of r.value.promoted) promotedUnion.add(id);
        }
      }
      // Exactly 2 distinct promotions across all overlapping drains.
      expect(promotedUnion.size).toBe(2);

      const status = await getJobConcurrencyStatus(dir, 2, 1000);
      expect(status.activeJobs.length).toBe(2);
      expect(status.runningCount).toBe(2);

      // Two seeds remain in pending (the two not promoted).
      const remainingPending = (await readdir(join(dir, "pending"))).sort();
      expect(remainingPending.length).toBe(2);
    } finally {
      await rm(dir, { recursive: true });
    }
  });
});
