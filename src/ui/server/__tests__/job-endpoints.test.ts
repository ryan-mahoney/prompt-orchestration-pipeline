import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resetConfig } from "../../../core/config";
import { handleJobDetail } from "../endpoints/job-endpoints";
import { initPATHS, resetPATHS } from "../config-bridge-node";

const tempRoots: string[] = [];

let savedPoRoot: string | undefined;

async function makeTempRoot(): Promise<string> {
  const root = await Bun.$`mktemp -d ${path.join(tmpdir(), "job-endpoints-XXXXXX")}`.text();
  const trimmed = root.trim();
  tempRoots.push(trimmed);
  return trimmed;
}

async function writePipelineRegistry(root: string): Promise<void> {
  const configDir = path.join(root, "pipeline-config", "demo");
  const tasksDir = path.join(configDir, "tasks");
  await mkdir(tasksDir, { recursive: true });
  await writeFile(
    path.join(root, "pipeline-config", "registry.json"),
    JSON.stringify({ pipelines: { demo: { configDir, tasksDir } } }),
  );
  await writeFile(
    path.join(configDir, "pipeline.json"),
    JSON.stringify({ marker: "shared", tasks: [{ name: "shared-task" }] }),
  );
}

async function writeJob(root: string, location: "current" | "complete", jobId: string): Promise<string> {
  const jobDir = path.join(root, "pipeline-data", location, jobId);
  await mkdir(jobDir, { recursive: true });
  await writeFile(
    path.join(jobDir, "tasks-status.json"),
    JSON.stringify({
      id: jobId,
      name: jobId,
      pipeline: "demo",
      createdAt: "2026-06-12T12:00:00.000Z",
      state: "pending",
      tasks: { "shared-task": { state: "pending" } },
    }),
  );
  return jobDir;
}

beforeEach(() => {
  savedPoRoot = process.env["PO_ROOT"];
});

afterEach(async () => {
  if (savedPoRoot === undefined) {
    delete process.env["PO_ROOT"];
  } else {
    process.env["PO_ROOT"] = savedPoRoot;
  }
  resetConfig();
  resetPATHS();
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("job endpoints pipeline config loading", () => {
  it("prefers current/{jobId}/pipeline.json over shared pipeline config", async () => {
    const root = await makeTempRoot();
    process.env["PO_ROOT"] = root;
    resetConfig();
    initPATHS(root);
    await writePipelineRegistry(root);
    const jobDir = await writeJob(root, "current", "job-current");
    await writeFile(
      path.join(jobDir, "pipeline.json"),
      JSON.stringify({ marker: "per-run-current", tasks: [{ name: "run-task" }] }),
    );

    const res = await handleJobDetail("job-current");
    const body = await res.json() as { data: { pipelineConfig?: Record<string, unknown> } };

    expect(res.status).toBe(200);
    expect(body.data.pipelineConfig?.["marker"]).toBe("per-run-current");
    expect(body.data.pipelineConfig?.["tasks"]).toEqual([{ name: "run-task" }]);
  });

  it("prefers complete/{jobId}/pipeline.json over shared pipeline config", async () => {
    const root = await makeTempRoot();
    process.env["PO_ROOT"] = root;
    resetConfig();
    initPATHS(root);
    await writePipelineRegistry(root);
    const jobDir = await writeJob(root, "complete", "job-complete");
    await writeFile(
      path.join(jobDir, "pipeline.json"),
      JSON.stringify({ marker: "per-run-complete", tasks: [{ name: "archived-task" }] }),
    );

    const res = await handleJobDetail("job-complete");
    const body = await res.json() as { data: { pipelineConfig?: Record<string, unknown> } };

    expect(res.status).toBe(200);
    expect(body.data.pipelineConfig?.["marker"]).toBe("per-run-complete");
    expect(body.data.pipelineConfig?.["tasks"]).toEqual([{ name: "archived-task" }]);
  });

  it("falls back to shared pipeline config for legacy jobs without a per-run definition", async () => {
    const root = await makeTempRoot();
    process.env["PO_ROOT"] = root;
    resetConfig();
    initPATHS(root);
    await writePipelineRegistry(root);
    await writeJob(root, "current", "job-legacy");

    const res = await handleJobDetail("job-legacy");
    const body = await res.json() as { data: { pipelineConfig?: Record<string, unknown> } };

    expect(res.status).toBe(200);
    expect(body.data.pipelineConfig?.["marker"]).toBe("shared");
    expect(body.data.pipelineConfig?.["tasks"]).toEqual([{ name: "shared-task" }]);
  });
});
