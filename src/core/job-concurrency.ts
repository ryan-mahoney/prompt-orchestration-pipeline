import { mkdir, readdir, readFile, rename, rm, rmdir, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

const SEED_FILENAME_PATTERN = /^([A-Za-z0-9][A-Za-z0-9-_]*)-seed\.json$/;
const TEMP_LEASE_PATTERN = /\.json\.tmp\.[a-f0-9]+$/;
const LOCK_POLL_INTERVAL_MS = 25;
const DEFAULT_STALE_LEASE_TIMEOUT_MS = 30_000;

export interface JobSlotLease {
  jobId: string;
  pid: number | null;
  acquiredAt: string;
  source: "orchestrator" | "restart" | "task-start";
  slotPath: string;
}

export interface QueuedJobSummary {
  jobId: string;
  seedPath: string;
  queuedAt: string | null;
  name: string | null;
  pipeline: string | null;
}

export interface StaleJobSlot {
  jobId: string;
  slotPath: string;
  reason: "missing_current_job" | "missing_pid" | "dead_pid" | "invalid_json";
}

export interface JobConcurrencyStatus {
  limit: number;
  runningCount: number;
  availableSlots: number;
  queuedCount: number;
  activeJobs: JobSlotLease[];
  queuedJobs: QueuedJobSummary[];
  staleSlots: StaleJobSlot[];
}

export type AcquireJobSlotResult =
  | { ok: true; lease: JobSlotLease }
  | { ok: false; reason: "limit_reached" | "already_held"; status: JobConcurrencyStatus };

export interface AcquireJobSlotOptions {
  dataDir: string;
  jobId: string;
  maxConcurrentJobs: number;
  source: JobSlotLease["source"];
  pid?: number | null;
  lockTimeoutMs?: number;
}

export interface ConcurrencyRuntimePaths {
  runtimeDir: string;
  lockDir: string;
  runningJobsDir: string;
}

export function getConcurrencyRuntimePaths(dataDir: string): ConcurrencyRuntimePaths {
  const runtimeDir = join(dataDir, "runtime");
  return {
    runtimeDir,
    lockDir: join(runtimeDir, "lock"),
    runningJobsDir: join(runtimeDir, "running-jobs"),
  };
}

interface SeedFileEntry {
  jobId: string;
  seedPath: string;
  mtime: Date;
}

async function readPendingSeedEntries(pendingDir: string): Promise<SeedFileEntry[]> {
  let names: string[];
  try {
    names = await readdir(pendingDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const entries: SeedFileEntry[] = [];
  for (const name of names) {
    const match = SEED_FILENAME_PATTERN.exec(name);
    if (!match) continue;
    const seedPath = join(pendingDir, name);
    let stats: Awaited<ReturnType<typeof stat>>;
    try {
      stats = await stat(seedPath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw err;
    }
    entries.push({ jobId: match[1]!, seedPath, mtime: stats.mtime });
  }
  return entries;
}

async function readSeedMetadata(seedPath: string): Promise<{ name: string | null; pipeline: string | null } | null> {
  try {
    const raw = await readFile(seedPath, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const name = typeof parsed["name"] === "string" ? (parsed["name"] as string) : null;
    const pipeline = typeof parsed["pipeline"] === "string" ? (parsed["pipeline"] as string) : null;
    return { name, pipeline };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    return { name: null, pipeline: null };
  }
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the process exists but is owned by another user — still alive.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function directoryExists(path: string): Promise<boolean> {
  try {
    const stats = await stat(path);
    return stats.isDirectory();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
}

async function removeLeaseFile(slotPath: string): Promise<void> {
  try {
    await unlink(slotPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}

async function classifyLease(
  dataDir: string,
  slotPath: string,
  fileName: string,
  lockTimeoutMs: number,
): Promise<StaleJobSlot | null> {
  const fallbackJobId = fileName.replace(/\.json$/, "");
  let raw: string;
  try {
    raw = await readFile(slotPath, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  let parsed: JobSlotLease;
  try {
    parsed = JSON.parse(raw) as JobSlotLease;
  } catch {
    return { jobId: fallbackJobId, slotPath, reason: "invalid_json" };
  }
  const jobId = typeof parsed.jobId === "string" ? parsed.jobId : fallbackJobId;
  const acquiredMs = Date.parse(parsed.acquiredAt);
  const leaseAgedOut = !Number.isFinite(acquiredMs) || Date.now() - acquiredMs >= lockTimeoutMs;
  if (!(await directoryExists(join(dataDir, "current", jobId)))) {
    // Grace window: drainPendingQueue acquires the slot before creating
    // current/<jobId>, so a fresh lease without a current dir is in-flight, not stale.
    if (!leaseAgedOut) return null;
    return { jobId, slotPath, reason: "missing_current_job" };
  }
  if (parsed.pid === null || parsed.pid === undefined) {
    if (leaseAgedOut) {
      return { jobId, slotPath, reason: "missing_pid" };
    }
    return null;
  }
  if (!isProcessAlive(parsed.pid)) {
    return { jobId, slotPath, reason: "dead_pid" };
  }
  return null;
}

async function listRunningJobFileNames(runningJobsDir: string): Promise<string[]> {
  try {
    const names = await readdir(runningJobsDir);
    return names.sort();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

async function removeStaleTempLeaseFiles(runningJobsDir: string, names: string[], lockTimeoutMs: number): Promise<void> {
  await Promise.all(
    names
      .filter((name) => TEMP_LEASE_PATTERN.test(name))
      .map(async (name) => {
        const tempPath = join(runningJobsDir, name);
        try {
          const stats = await stat(tempPath);
          if (Date.now() - stats.mtimeMs >= lockTimeoutMs) await removeLeaseFile(tempPath);
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
        }
      }),
  );
}

async function collectLeaseState(
  dataDir: string,
  lockTimeoutMs: number,
  prune: boolean,
): Promise<{ activeJobs: JobSlotLease[]; staleSlots: StaleJobSlot[] }> {
  const { runningJobsDir } = getConcurrencyRuntimePaths(dataDir);
  const names = await listRunningJobFileNames(runningJobsDir);
  if (prune) await removeStaleTempLeaseFiles(runningJobsDir, names, lockTimeoutMs);

  const staleSlots: StaleJobSlot[] = [];
  const stalePaths = new Set<string>();
  await Promise.all(names.map(async (name) => {
    if (!name.endsWith(".json") || TEMP_LEASE_PATTERN.test(name)) return;
    const slotPath = join(runningJobsDir, name);
    const result = await classifyLease(dataDir, slotPath, name, lockTimeoutMs);
    if (result) {
      staleSlots.push(result);
      stalePaths.add(slotPath);
    }
  }));
  staleSlots.sort((a, b) => a.jobId.localeCompare(b.jobId));

  if (prune) {
    await Promise.all(staleSlots.map((slot) => removeLeaseFile(slot.slotPath)));
  }

  const activeJobs = await readActiveLeases(runningJobsDir, stalePaths);
  return { activeJobs, staleSlots };
}

export async function pruneStaleJobSlots(
  dataDir: string,
  lockTimeoutMs: number,
): Promise<StaleJobSlot[]> {
  return withRuntimeLock(dataDir, lockTimeoutMs, async () => {
    const { staleSlots } = await collectLeaseState(dataDir, lockTimeoutMs, true);
    return staleSlots;
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// mkdir with recursive:false is atomic — exactly one caller wins the create when racing.
async function withRuntimeLock<T>(
  dataDir: string,
  lockTimeoutMs: number,
  fn: () => Promise<T>,
): Promise<T> {
  const { lockDir, runtimeDir } = getConcurrencyRuntimePaths(dataDir);
  const ownerPath = join(lockDir, "owner.json");
  await mkdir(runtimeDir, { recursive: true });
  const start = Date.now();
  while (true) {
    try {
      await mkdir(lockDir, { recursive: false });
      try {
        await writeFile(ownerPath, JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }));
      } catch (ownerErr) {
        await rm(lockDir, { recursive: true, force: true });
        throw ownerErr;
      }
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      if (Date.now() - start < lockTimeoutMs) {
        await delay(LOCK_POLL_INTERVAL_MS);
        continue;
      }
      try {
        const raw = await readFile(ownerPath, "utf-8");
        const owner = JSON.parse(raw) as { acquiredAt?: unknown; pid?: unknown };
        const ownerAcquiredMs = typeof owner.acquiredAt === "string" ? Date.parse(owner.acquiredAt) : NaN;
        const ownerTimedOut = Number.isFinite(ownerAcquiredMs) && Date.now() - ownerAcquiredMs >= lockTimeoutMs;
        if (typeof owner.pid === "number" && !isProcessAlive(owner.pid)) {
          await rm(lockDir, { recursive: true, force: true });
          continue;
        }
        if (typeof owner.pid !== "number" && ownerTimedOut) {
          await rm(lockDir, { recursive: true, force: true });
          continue;
        }
      } catch (ownerErr) {
        if ((ownerErr as NodeJS.ErrnoException).code === "ENOENT") {
          const stats = await stat(lockDir);
          if (Date.now() - stats.mtimeMs >= lockTimeoutMs) {
            await rm(lockDir, { recursive: true, force: true });
            continue;
          }
        }
      }
      throw new Error(`failed to acquire runtime lock at ${lockDir} within ${lockTimeoutMs}ms`);
    }
  }
  try {
    return await fn();
  } finally {
    try {
      await unlink(ownerPath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    try {
      await rmdir(lockDir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }
}

async function buildStatus(
  dataDir: string,
  maxConcurrentJobs: number,
  lockTimeoutMs: number,
  prune: boolean,
): Promise<JobConcurrencyStatus> {
  const { activeJobs, staleSlots } = await collectLeaseState(dataDir, lockTimeoutMs, prune);
  const queuedJobs = await listQueuedSeeds(dataDir);
  return {
    limit: maxConcurrentJobs,
    runningCount: activeJobs.length,
    availableSlots: Math.max(0, maxConcurrentJobs - activeJobs.length),
    queuedCount: queuedJobs.length,
    activeJobs,
    queuedJobs,
    staleSlots,
  };
}

async function readLease(slotPath: string): Promise<JobSlotLease | null> {
  try {
    const raw = await readFile(slotPath, "utf-8");
    return JSON.parse(raw) as JobSlotLease;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

async function writeLeaseAtomic(slotPath: string, lease: JobSlotLease): Promise<void> {
  const tmpPath = `${slotPath}.tmp.${randomBytes(8).toString("hex")}`;
  await writeFile(tmpPath, JSON.stringify(lease));
  await rename(tmpPath, slotPath);
}

async function readActiveLeases(runningJobsDir: string, excludePaths = new Set<string>()): Promise<JobSlotLease[]> {
  let names: string[];
  try {
    names = await readdir(runningJobsDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const leases: JobSlotLease[] = [];
  for (const name of names) {
    const slotPath = join(runningJobsDir, name);
    if (!name.endsWith(".json") || TEMP_LEASE_PATTERN.test(name) || excludePaths.has(slotPath)) continue;
    const lease = await readLease(slotPath);
    if (lease) leases.push(lease);
  }
  leases.sort(
    (a, b) =>
      Date.parse(a.acquiredAt) - Date.parse(b.acquiredAt) || a.jobId.localeCompare(b.jobId),
  );
  return leases;
}

export async function tryAcquireJobSlot(
  options: AcquireJobSlotOptions,
): Promise<AcquireJobSlotResult> {
  const { dataDir, jobId, maxConcurrentJobs, source } = options;
  const lockTimeoutMs = options.lockTimeoutMs ?? DEFAULT_STALE_LEASE_TIMEOUT_MS;
  const { runningJobsDir } = getConcurrencyRuntimePaths(dataDir);
  await mkdir(runningJobsDir, { recursive: true });
  return withRuntimeLock(dataDir, lockTimeoutMs, async () => {
    const status = await buildStatus(dataDir, maxConcurrentJobs, lockTimeoutMs, true);
    const activeJobs = status.activeJobs;
    const slotPath = join(runningJobsDir, `${jobId}.json`);
    if (activeJobs.some((l) => l.jobId === jobId)) {
      return { ok: false, reason: "already_held", status };
    }
    if (activeJobs.length >= maxConcurrentJobs) {
      return { ok: false, reason: "limit_reached", status };
    }
    const lease: JobSlotLease = {
      jobId,
      pid: options.pid ?? null,
      acquiredAt: new Date().toISOString(),
      source,
      slotPath,
    };
    await writeLeaseAtomic(slotPath, lease);
    return { ok: true, lease };
  });
}

export async function updateJobSlotPid(
  dataDir: string,
  jobId: string,
  pid: number,
  lockTimeoutMs = DEFAULT_STALE_LEASE_TIMEOUT_MS,
): Promise<void> {
  const { runningJobsDir } = getConcurrencyRuntimePaths(dataDir);
  await withRuntimeLock(dataDir, lockTimeoutMs, async () => {
    const slotPath = join(runningJobsDir, `${jobId}.json`);
    const lease = await readLease(slotPath);
    if (!lease) throw new Error(`no lease found for job ${jobId}`);
    await writeLeaseAtomic(slotPath, { ...lease, pid });
  });
}

export async function releaseJobSlot(
  dataDir: string,
  jobId: string,
  lockTimeoutMs = DEFAULT_STALE_LEASE_TIMEOUT_MS,
): Promise<void> {
  const { runningJobsDir } = getConcurrencyRuntimePaths(dataDir);
  await withRuntimeLock(dataDir, lockTimeoutMs, async () => {
    try {
      await unlink(join(runningJobsDir, `${jobId}.json`));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  });
}

export async function getJobConcurrencyStatus(
  dataDir: string,
  maxConcurrentJobs: number,
  lockTimeoutMs: number,
): Promise<JobConcurrencyStatus> {
  return withRuntimeLock(dataDir, lockTimeoutMs, () =>
    buildStatus(dataDir, maxConcurrentJobs, lockTimeoutMs, true),
  );
}

export async function listQueuedSeeds(dataDir: string): Promise<QueuedJobSummary[]> {
  const entries = await readPendingSeedEntries(join(dataDir, "pending"));
  entries.sort((a, b) => a.mtime.getTime() - b.mtime.getTime() || a.jobId.localeCompare(b.jobId));
  const summaries = await Promise.all(entries.map(async (entry): Promise<QueuedJobSummary | null> => {
    const metadata = await readSeedMetadata(entry.seedPath);
    if (!metadata) return null;
    return {
      jobId: entry.jobId,
      seedPath: entry.seedPath,
      queuedAt: entry.mtime.toISOString(),
      name: metadata.name,
      pipeline: metadata.pipeline,
    };
  }));
  return summaries.filter((summary): summary is QueuedJobSummary => summary !== null);
}
