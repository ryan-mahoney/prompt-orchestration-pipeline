import { readdir } from "node:fs/promises";

import { getPATHS } from "./config-bridge-node";

export interface JobDirectoryStats {
  location: string;
  exists: boolean;
  jobCount: number;
  totalEntries: number;
  error?: string;
}

const VALID_LOCATIONS = new Set(["current", "complete", "pending", "rejected"]);

export async function listJobs(location: string): Promise<string[]> {
  if (!VALID_LOCATIONS.has(location)) return [];

  try {
    const entries = await readdir(getPATHS()[location as keyof ReturnType<typeof getPATHS>], {
      withFileTypes: true,
    });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return [];
  }
}

export async function listAllJobs(): Promise<{ current: string[]; complete: string[] }> {
  const [current, complete] = await Promise.all([listJobs("current"), listJobs("complete")]);
  return { current, complete };
}

export async function getJobDirectoryStats(location: string): Promise<JobDirectoryStats> {
  if (!VALID_LOCATIONS.has(location)) {
    return { location, exists: false, jobCount: 0, totalEntries: 0 };
  }

  try {
    const entries = await readdir(getPATHS()[location as keyof ReturnType<typeof getPATHS>], {
      withFileTypes: true,
    });
    return {
      location,
      exists: true,
      jobCount: entries.filter((entry) => entry.isDirectory()).length,
      totalEntries: entries.length,
    };
  } catch (error) {
    return {
      location,
      exists: false,
      jobCount: 0,
      totalEntries: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
