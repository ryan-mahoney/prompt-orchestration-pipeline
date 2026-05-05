import { describe, test, expect } from "bun:test";
import { mkdtemp, mkdir, writeFile, utimes, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getConcurrencyRuntimePaths, listQueuedSeeds } from "../job-concurrency";

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
