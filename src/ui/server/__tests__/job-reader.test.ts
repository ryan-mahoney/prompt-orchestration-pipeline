import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { initPATHS, resetPATHS } from "../config-bridge-node";
import { readJob, readMultipleJobs } from "../job-reader";

const tempRoots: string[] = [];

async function makeTempRoot(): Promise<string> {
  const root = await Bun.$`mktemp -d ${path.join(os.tmpdir(), "job-reader-XXXXXX")}`.text();
  const trimmed = root.trim();
  tempRoots.push(trimmed);
  return trimmed;
}

afterEach(async () => {
  resetPATHS();
  await Promise.all(tempRoots.splice(0).map((root) => Bun.$`rm -rf ${root}`));
});

describe("job-reader", () => {
  it("reads jobs from current before complete", async () => {
    const root = await makeTempRoot();
    initPATHS(root);
    const currentDir = path.join(root, "pipeline-data", "current", "job-1");
    await mkdir(currentDir, { recursive: true });
    await writeFile(path.join(currentDir, "tasks-status.json"), '{"id":"job-1","tasks":{}}');

    await expect(readJob("job-1")).resolves.toMatchObject({ ok: true, location: "current" });
  });

  it("falls back to complete and returns structured errors", async () => {
    const root = await makeTempRoot();
    initPATHS(root);
    const completeDir = path.join(root, "pipeline-data", "complete", "job-2");
    await mkdir(completeDir, { recursive: true });
    await writeFile(path.join(completeDir, "tasks-status.json"), '{"id":"job-2","tasks":{}}');
    await writeFile(path.join(completeDir, "run.lock"), "");

    await expect(readJob("job-2")).resolves.toMatchObject({ ok: true, location: "complete", locked: true });
    await expect(readJob("missing")).resolves.toMatchObject({ ok: false, code: "JOB_NOT_FOUND" });
    await expect(readJob("../bad")).resolves.toMatchObject({ ok: false, code: "BAD_REQUEST" });
  });

  it("reads multiple jobs in parallel", async () => {
    const root = await makeTempRoot();
    initPATHS(root);
    for (const jobId of ["job-a", "job-b"]) {
      const jobDir = path.join(root, "pipeline-data", "current", jobId);
      await mkdir(jobDir, { recursive: true });
      await writeFile(path.join(jobDir, "tasks-status.json"), `{"id":"${jobId}","tasks":{}}`);
    }

    const results = await readMultipleJobs(["job-a", "job-b"]);
    expect(results).toHaveLength(2);
    expect(results.every((result) => result.ok)).toBe(true);
  });
});
