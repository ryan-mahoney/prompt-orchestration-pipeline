import { listAllJobs } from "./job-scanner";
import { readMultipleJobs } from "./job-reader";

export interface JobIndexEntry {
  location: string;
  path: string;
  [key: string]: unknown;
}

export interface JobIndexStats {
  totalJobs: number;
  byLocation: Record<string, number>;
  lastRefreshAt: string | null;
}

export class JobIndex {
  #entries = new Map<string, JobIndexEntry>();
  #refreshing: Promise<void> | null = null;
  #lastRefreshAt: string | null = null;

  async refresh(): Promise<void> {
    if (this.#refreshing) return this.#refreshing;

    this.#refreshing = (async () => {
      const listed = await listAllJobs();
      const jobIds = [...new Set([...listed.current, ...listed.complete])];
      const results = await readMultipleJobs(jobIds);
      this.#entries.clear();
      for (const result of results) {
        if (!result.ok) continue;
        this.updateJob(result.jobId, result.data, result.location, result.path);
      }
      this.#lastRefreshAt = new Date().toISOString();
    })().finally(() => {
      this.#refreshing = null;
    });

    return this.#refreshing;
  }

  getJob(id: string): JobIndexEntry | undefined {
    return this.#entries.get(id);
  }

  getAllJobs(): JobIndexEntry[] {
    return [...this.#entries.values()];
  }

  getJobsByLocation(location: string): JobIndexEntry[] {
    return this.getAllJobs().filter((job) => job.location === location);
  }

  hasJob(id: string): boolean {
    return this.#entries.has(id);
  }

  getJobCount(): number {
    return this.#entries.size;
  }

  getStats(): JobIndexStats {
    const byLocation = this.getAllJobs().reduce<Record<string, number>>((acc, job) => {
      acc[job.location] = (acc[job.location] ?? 0) + 1;
      return acc;
    }, {});
    return {
      totalJobs: this.getJobCount(),
      byLocation,
      lastRefreshAt: this.#lastRefreshAt,
    };
  }

  clear(): void {
    this.#entries.clear();
    this.#lastRefreshAt = null;
  }

  updateJob(id: string, data: Record<string, unknown>, location: string, path: string): void {
    this.#entries.set(id, { ...data, location, path });
  }

  removeJob(id: string): void {
    this.#entries.delete(id);
  }
}

let jobIndex: JobIndex | null = null;

export function createJobIndex(): JobIndex {
  return new JobIndex();
}

export function getJobIndex(): JobIndex {
  if (!jobIndex) jobIndex = createJobIndex();
  return jobIndex;
}

export function resetJobIndex(): void {
  jobIndex = null;
}
