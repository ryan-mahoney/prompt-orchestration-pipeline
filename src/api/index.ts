import path from "node:path";
import { mkdir, readdir, rename, stat } from "node:fs/promises";
import { resolvePipelinePaths, getPendingSeedPath } from "../config/paths";
import type { PipelinePaths } from "../config/paths";
import { getPipelineConfig } from "../core/config";
import { deriveJobStatusFromTasks } from "../config/statuses";
import { SEED_PATTERN } from "../core/orchestrator";

/** Result of a successful job submission. */
export interface SubmitSuccessResult {
  success: true;
  jobId: string;
  jobName: string;
}

/** Result of a failed job submission. */
export interface SubmitFailureResult {
  success: false;
  message: string;
}

export type SubmitResult = SubmitSuccessResult | SubmitFailureResult;

/** Options for submitJobWithValidation. */
export interface SubmitJobOptions {
  dataDir: string;
  seedObject: unknown;
}

/** Job status record returned by getStatus. */
export interface JobStatusRecord {
  jobId: string;
  jobName: string;
  pipeline: string;
  state: string;
  createdAt: string;
  [key: string]: unknown;
}

/** Orchestrator construction options. */
export interface OrchestratorOptions {
  autoStart: boolean;
}

// ─── Private Helpers ──────────────────────────────────────────────────────────

async function atomicWriteJson(filePath: string, data: unknown): Promise<void> {
  const tmp = `${filePath}.${Date.now()}.tmp`;
  await Bun.write(tmp, JSON.stringify(data, null, 2));
  await rename(tmp, filePath);
}

function assertSeedObject(value: unknown): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("seed must be a JSON object");
  }
}

function assertPipelineSlug(value: unknown): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("seed.pipeline must be a non-empty string");
  }
}

async function safeReaddir(dirPath: string): Promise<string[]> {
  try {
    return await readdir(dirPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

async function readJsonFile<T = unknown>(filePath: string): Promise<T> {
  const text = await Bun.file(filePath).text();
  return JSON.parse(text) as T;
}

function mapStatusToRecord(data: Record<string, unknown>): JobStatusRecord {
  const { id, name, pipeline, state, createdAt, ...rest } = data;
  return {
    jobId: String(id ?? ""),
    jobName: String(name ?? id ?? ""),
    pipeline: String(pipeline ?? ""),
    state: String(state ?? ""),
    createdAt: String(createdAt ?? ""),
    ...rest,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function submitJobWithValidation(
  opts: SubmitJobOptions,
): Promise<SubmitResult> {
  const rootDir = path.resolve(opts.dataDir);

  try {
    assertSeedObject(opts.seedObject);
    assertPipelineSlug(opts.seedObject["pipeline"]);
  } catch (err) {
    return { success: false, message: (err as Error).message };
  }

  const seed = opts.seedObject as Record<string, unknown>;

  if (seed["name"] !== undefined) {
    if (typeof seed["name"] !== "string" || seed["name"].length === 0) {
      return { success: false, message: "seed.name must be a non-empty string if provided" };
    }
  }

  try {
    getPipelineConfig(seed["pipeline"] as string, rootDir);
  } catch (err) {
    return { success: false, message: (err as Error).message };
  }

  const jobId = crypto.randomUUID();
  const jobName = (typeof seed["name"] === "string" && seed["name"].length > 0)
    ? seed["name"]
    : jobId;
  const pendingPath = getPendingSeedPath(rootDir, jobId);

  await mkdir(path.dirname(pendingPath), { recursive: true });

  try {
    await atomicWriteJson(pendingPath, opts.seedObject);
  } catch (err) {
    throw new Error(`failed to write seed file for job ${jobId}: ${(err as Error).message}`);
  }

  return { success: true, jobId, jobName };
}

export class PipelineOrchestrator {
  private readonly autoStart: boolean;
  private readonly root: string;
  private readonly paths: PipelinePaths;

  constructor(opts: OrchestratorOptions) {
    this.autoStart = opts.autoStart;
    this.root = path.resolve(process.env["PO_ROOT"] ?? process.cwd());
    this.paths = resolvePipelinePaths(this.root);
  }

  async getStatus(jobName: string): Promise<JobStatusRecord> {
    // 1. Direct jobId lookup in current, then complete
    for (const dir of [this.paths.current, this.paths.complete]) {
      const statusPath = path.join(dir, jobName, "tasks-status.json");
      try {
        const data = await readJsonFile<Record<string, unknown>>(statusPath);
        return mapStatusToRecord(data);
      } catch {
        // not found here, continue
      }
    }

    // 2. Name scan fallback
    for (const dir of [this.paths.current, this.paths.complete]) {
      const entries = await safeReaddir(dir);
      for (const entry of entries) {
        if (entry === ".gitkeep") continue;
        const statusPath = path.join(dir, entry, "tasks-status.json");
        try {
          const data = await readJsonFile<Record<string, unknown>>(statusPath);
          if (data["name"] === jobName) {
            return mapStatusToRecord(data);
          }
        } catch {
          // skip unreadable entries
        }
      }
    }

    // 3. Pending fallback
    const pendingFiles = await safeReaddir(this.paths.pending);
    for (const file of pendingFiles) {
      const match = file.match(SEED_PATTERN);
      if (!match) continue;
      const id = match[1]!;
      if (id !== jobName) continue;

      const filePath = path.join(this.paths.pending, file);
      const seed = await readJsonFile<Record<string, unknown>>(filePath);
      const fileStat = await stat(filePath);
      return {
        jobId: id,
        jobName: typeof seed["name"] === "string" ? seed["name"] : id,
        pipeline: String(seed["pipeline"] ?? ""),
        state: "pending",
        createdAt: fileStat.birthtime.toISOString(),
      };
    }

    throw new Error(`job '${jobName}' not found in pending, current, or complete`);
  }

  async listJobs(): Promise<JobStatusRecord[]> {
    const results: JobStatusRecord[] = [];

    // Pending jobs
    const pendingFiles = await safeReaddir(this.paths.pending);
    for (const file of pendingFiles) {
      const match = file.match(SEED_PATTERN);
      if (!match) continue;
      const id = match[1]!;
      const filePath = path.join(this.paths.pending, file);
      try {
        const seed = await readJsonFile<Record<string, unknown>>(filePath);
        const fileStat = await stat(filePath);
        results.push({
          jobId: id,
          jobName: typeof seed["name"] === "string" ? seed["name"] : id,
          pipeline: String(seed["pipeline"] ?? ""),
          state: "pending",
          createdAt: fileStat.birthtime.toISOString(),
        });
      } catch (err) {
        console.warn(`[api] skipping unreadable pending seed ${file}: ${(err as Error).message}`);
      }
    }

    // Current jobs
    const currentEntries = await safeReaddir(this.paths.current);
    for (const entry of currentEntries) {
      if (entry === ".gitkeep") continue;
      const statusPath = path.join(this.paths.current, entry, "tasks-status.json");
      try {
        const data = await readJsonFile<Record<string, unknown>>(statusPath);
        const tasks = data["tasks"];
        const taskArray = tasks && typeof tasks === "object" && !Array.isArray(tasks)
          ? Object.values(tasks as Record<string, { state: unknown }>)
          : [];
        const state = deriveJobStatusFromTasks(taskArray);
        const record = mapStatusToRecord(data);
        record.state = state;
        results.push(record);
      } catch (err) {
        console.warn(`[api] skipping unreadable current job ${entry}: ${(err as Error).message}`);
      }
    }

    // Complete jobs
    const completeEntries = await safeReaddir(this.paths.complete);
    for (const entry of completeEntries) {
      if (entry === ".gitkeep") continue;
      const statusPath = path.join(this.paths.complete, entry, "tasks-status.json");
      try {
        const data = await readJsonFile<Record<string, unknown>>(statusPath);
        const record = mapStatusToRecord(data);
        record.state = "complete";
        results.push(record);
      } catch (err) {
        console.warn(`[api] skipping unreadable complete job ${entry}: ${(err as Error).message}`);
      }
    }

    return results;
  }
}
