import { VERSION } from "../../index";
import { transformMultipleJobs as defaultTransformMultipleJobs } from "./transformers/status-transformer";
import type {
  ComposeSnapshotOptions,
  FilesystemSnapshot,
  JobReadResult,
  NormalizedJob,
  SnapshotDeps,
  SnapshotJob,
  StateSnapshot,
} from "./types";

const SNAPSHOT_STATUS_ORDER = ["error", "running", "complete", "pending"] as const;

function nowIso(now: (() => Date) | undefined): string {
  return (now ?? (() => new Date()))().toISOString();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizeJob(raw: unknown): NormalizedJob {
  const job = asRecord(raw);
  if (!job) {
    return { jobId: null, status: null, title: null, updatedAt: null };
  }

  const rawJobId = job["jobId"] ?? job["id"] ?? job["uid"] ?? job["job_id"] ?? job["jobID"];
  return {
    jobId: typeof rawJobId === "string" ? rawJobId : null,
    status: typeof job["status"] === "string" ? job["status"] : null,
    title: typeof (job["title"] ?? job["name"]) === "string" ? ((job["title"] ?? job["name"]) as string) : null,
    updatedAt: typeof job["updatedAt"] === "string" ? job["updatedAt"] : null,
  };
}

function getVersion(meta: unknown): string {
  if (typeof meta === "string") return meta;
  const record = asRecord(meta);
  return typeof record?.["version"] === "string" ? (record["version"] as string) : VERSION;
}

function mapSnapshotJob(job: Record<string, unknown>): SnapshotJob {
  return {
    jobId: String(job["jobId"] ?? job["id"]),
    title: typeof job["title"] === "string" ? job["title"] : String(job["name"] ?? job["jobId"] ?? job["id"]),
    status: typeof job["status"] === "string" ? job["status"] : "pending",
    progress: typeof job["progress"] === "number" ? job["progress"] : 0,
    createdAt: typeof job["createdAt"] === "string" ? job["createdAt"] : null,
    updatedAt: typeof job["updatedAt"] === "string" ? job["updatedAt"] : null,
    location: typeof job["location"] === "string" ? job["location"] : "current",
  };
}

function sortSnapshotJobs(left: SnapshotJob, right: SnapshotJob): number {
  const locationWeight = (value: string): number => (value === "current" ? 0 : 1);
  const location = locationWeight(left.location) - locationWeight(right.location);
  if (location !== 0) return location;

  const status =
    SNAPSHOT_STATUS_ORDER.indexOf(left.status as (typeof SNAPSHOT_STATUS_ORDER)[number]) -
    SNAPSHOT_STATUS_ORDER.indexOf(right.status as (typeof SNAPSHOT_STATUS_ORDER)[number]);
  if (status !== 0) return status;

  const updatedAt = (right.updatedAt ?? "").localeCompare(left.updatedAt ?? "");
  if (updatedAt !== 0) return updatedAt;

  return left.jobId.localeCompare(right.jobId);
}

async function resolveDeps(
  deps: SnapshotDeps,
): Promise<Required<Pick<SnapshotDeps, "listAllJobs" | "readJob" | "transformMultipleJobs" | "now">>> {
  const listAllJobs = deps.listAllJobs ?? null;
  const readJob = deps.readJob ?? null;
  const transformMultipleJobs = deps.transformMultipleJobs ?? defaultTransformMultipleJobs;
  const now = deps.now ?? (() => new Date());

  if (listAllJobs && readJob) {
    return { listAllJobs, readJob, transformMultipleJobs, now };
  }

  try {
    const scannerPath = "../server/job-scanner";
    const readerPath = "../server/job-reader";
    const scannerModule = await import(/* @vite-ignore */ scannerPath);
    const readerModule = await import(/* @vite-ignore */ readerPath);
    return {
      listAllJobs: listAllJobs ?? scannerModule.listAllJobs,
      readJob: readJob ?? readerModule.readJob,
      transformMultipleJobs,
      now,
    };
  } catch {
    throw new Error("snapshot dependencies are unavailable");
  }
}

export function composeStateSnapshot(options: ComposeSnapshotOptions = {}): StateSnapshot {
  try {
    const jobs = Array.isArray(options.jobs) ? options.jobs : [];
    const transformJob = options.transformJob ?? normalizeJob;
    return {
      jobs: jobs.map((job) => {
        try {
          return transformJob(job);
        } catch {
          return normalizeJob(null);
        }
      }),
      meta: {
        version: getVersion(options.meta),
        lastUpdated: new Date().toISOString(),
      },
    };
  } catch {
    return {
      jobs: [],
      meta: {
        version: VERSION,
        lastUpdated: new Date().toISOString(),
      },
    };
  }
}

export async function buildSnapshotFromFilesystem(deps: SnapshotDeps = {}): Promise<FilesystemSnapshot> {
  const resolved = await resolveDeps(deps);
  const listedJobs = await resolved.listAllJobs();
  const readRequests = [
    ...listedJobs.current.map((jobId) => ({ jobId, location: "current" })),
    ...listedJobs.complete.map((jobId) => ({ jobId, location: "complete" })),
  ];

  const readResults = await Promise.all(
    readRequests.map(async ({ jobId, location }) => {
      try {
        return await resolved.readJob(jobId, location);
      } catch (error) {
        console.warn(`failed to read job "${jobId}" from "${location}"`, error);
        return { ok: false, jobId, location, message: String(error) } satisfies JobReadResult;
      }
    }),
  );

  const transformed = resolved.transformMultipleJobs(readResults);
  const deduped = new Map<string, SnapshotJob>();

  for (const job of transformed) {
    const snapshotJob = mapSnapshotJob(job as unknown as Record<string, unknown>);
    if (snapshotJob.location === "current" || !deduped.has(snapshotJob.jobId)) {
      deduped.set(snapshotJob.jobId, snapshotJob);
    }
  }

  return {
    jobs: [...deduped.values()].sort(sortSnapshotJobs),
    meta: {
      version: VERSION,
      lastUpdated: nowIso(resolved.now),
    },
  };
}
