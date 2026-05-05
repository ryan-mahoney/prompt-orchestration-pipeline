import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

const SEED_FILENAME_PATTERN = /^([A-Za-z0-9-_]+)-seed\.json$/;

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
  | { ok: false; reason: "limit_reached"; status: JobConcurrencyStatus };

export interface AcquireJobSlotOptions {
  dataDir: string;
  jobId: string;
  maxConcurrentJobs: number;
  source: JobSlotLease["source"];
  pid?: number | null;
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
    const stats = await stat(seedPath);
    entries.push({ jobId: match[1]!, seedPath, mtime: stats.mtime });
  }
  return entries;
}

async function readSeedMetadata(seedPath: string): Promise<{ name: string | null; pipeline: string | null }> {
  try {
    const raw = await readFile(seedPath, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const name = typeof parsed["name"] === "string" ? (parsed["name"] as string) : null;
    const pipeline = typeof parsed["pipeline"] === "string" ? (parsed["pipeline"] as string) : null;
    return { name, pipeline };
  } catch {
    return { name: null, pipeline: null };
  }
}

export async function listQueuedSeeds(dataDir: string): Promise<QueuedJobSummary[]> {
  const entries = await readPendingSeedEntries(join(dataDir, "pending"));
  entries.sort((a, b) => a.mtime.getTime() - b.mtime.getTime() || a.jobId.localeCompare(b.jobId));
  const summaries: QueuedJobSummary[] = [];
  for (const entry of entries) {
    const { name, pipeline } = await readSeedMetadata(entry.seedPath);
    summaries.push({
      jobId: entry.jobId,
      seedPath: entry.seedPath,
      queuedAt: entry.mtime.toISOString(),
      name,
      pipeline,
    });
  }
  return summaries;
}
