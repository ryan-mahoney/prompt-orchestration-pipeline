import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  getJobPath,
  getPATHS,
  initPATHS,
  isLocked,
  resetPATHS,
  resolvePipelinePaths,
} from "../config-bridge-node";

const tempRoots: string[] = [];

async function makeTempRoot(): Promise<string> {
  const root = await Bun.$`mktemp -d ${path.join(os.tmpdir(), "ui-server-node-XXXXXX")}`.text();
  const trimmed = root.trim();
  tempRoots.push(trimmed);
  return trimmed;
}

afterEach(async () => {
  resetPATHS();
  await Promise.all(tempRoots.splice(0).map((root) => Bun.$`rm -rf ${root}`));
});

describe("config-bridge-node", () => {
  it("resolves pipeline paths", () => {
    expect(resolvePipelinePaths("/tmp/test")).toEqual({
      current: "/tmp/test/pipeline-data/current",
      complete: "/tmp/test/pipeline-data/complete",
      pending: "/tmp/test/pipeline-data/pending",
      rejected: "/tmp/test/pipeline-data/rejected",
    });
  });

  it("builds job paths from cached paths", () => {
    initPATHS("/tmp/test");
    expect(getJobPath("job-1", "current")).toBe("/tmp/test/pipeline-data/current/job-1");
    expect(getPATHS()).toEqual(resolvePipelinePaths("/tmp/test"));
  });

  it("detects lock files one level deep", async () => {
    const root = await makeTempRoot();
    const jobDir = path.join(root, "job");
    await mkdir(path.join(jobDir, "nested"), { recursive: true });
    await writeFile(path.join(jobDir, "nested", "run.lock"), "");
    expect(await isLocked(jobDir)).toBe(true);
    expect(await isLocked(path.join(root, "missing"))).toBe(false);
  });
});
