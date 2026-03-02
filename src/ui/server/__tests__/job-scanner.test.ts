import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { initPATHS, resetPATHS } from "../config-bridge-node";
import { getJobDirectoryStats, listAllJobs, listJobs } from "../job-scanner";

const tempRoots: string[] = [];

async function makeTempRoot(): Promise<string> {
  const root = await Bun.$`mktemp -d ${path.join(os.tmpdir(), "job-scanner-XXXXXX")}`.text();
  const trimmed = root.trim();
  tempRoots.push(trimmed);
  await mkdir(path.join(trimmed, "pipeline-data", "current", "job-1"), { recursive: true });
  await mkdir(path.join(trimmed, "pipeline-data", "complete", "job-2"), { recursive: true });
  return trimmed;
}

afterEach(async () => {
  resetPATHS();
  await Promise.all(tempRoots.splice(0).map((root) => Bun.$`rm -rf ${root}`));
});

describe("job-scanner", () => {
  it("lists job directories by lifecycle", async () => {
    const root = await makeTempRoot();
    initPATHS(root);
    await expect(listJobs("current")).resolves.toEqual(["job-1"]);
    await expect(listJobs("invalid")).resolves.toEqual([]);
    await expect(listAllJobs()).resolves.toEqual({ current: ["job-1"], complete: ["job-2"] });
  });

  it("reports directory stats", async () => {
    const root = await makeTempRoot();
    initPATHS(root);
    await expect(getJobDirectoryStats("current")).resolves.toMatchObject({
      location: "current",
      exists: true,
      jobCount: 1,
    });
  });
});
