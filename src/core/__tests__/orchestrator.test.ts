import { describe, test, expect } from "bun:test";
import { mkdtemp, mkdir, writeFile, utimes, rm, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { drainPendingQueue } from "../orchestrator";
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

  test("if spawnRunner throws, the slot is released and the error propagates", async () => {
    const dir = await setupDir("drain-spawn-err-");
    try {
      await writeSeed(dir, "job-bad", { pipeline: "p" }, 1700000000);
      const failingSpawn = async (): Promise<{ pid: number }> => {
        throw new Error("boom");
      };
      await expect(
        drainPendingQueue({
          dataDir: dir,
          maxConcurrentJobs: 2,
          lockTimeoutMs: 1000,
          spawnRunner: failingSpawn,
        }),
      ).rejects.toThrow(/boom/);
      const { runningJobsDir } = getConcurrencyRuntimePaths(dir);
      expect(existsSync(join(runningJobsDir, "job-bad.json"))).toBe(false);
      const status = await getJobConcurrencyStatus(dir, 2, 1000);
      expect(status.activeJobs).toEqual([]);
    } finally {
      await rm(dir, { recursive: true });
    }
  });
});
