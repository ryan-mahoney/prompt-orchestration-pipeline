import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { handleTaskFile, handleTaskFileList } from "../endpoints/file-endpoints";
import { initPATHS, resetPATHS } from "../config-bridge-node";

const tempRoots: string[] = [];

async function makeTempRoot(): Promise<string> {
  const root = await Bun.$`mktemp -d ${path.join(os.tmpdir(), "file-endpoints-XXXXXX")}`.text();
  const trimmed = root.trim();
  tempRoots.push(trimmed);
  return trimmed;
}

afterEach(async () => {
  delete process.env["PO_ROOT"];
  resetPATHS();
  await Promise.all(tempRoots.splice(0).map((root) => Bun.$`rm -rf ${root}`));
});

describe("file endpoints", () => {
  it("lists task files from tasks-status metadata", async () => {
    const root = await makeTempRoot();
    process.env["PO_ROOT"] = root;
    initPATHS(root);

    const jobDir = path.join(root, "pipeline-data", "current", "job-1");
    await mkdir(path.join(jobDir, "files", "artifacts"), { recursive: true });
    await writeFile(
      path.join(jobDir, "tasks-status.json"),
      JSON.stringify({
        id: "job-1",
        tasks: {
          research: {
            files: {
              artifacts: ["research-output.json"],
              logs: ["research.log"],
              tmp: [],
            },
          },
        },
      }),
    );

    const response = await handleTaskFileList(new Request("http://localhost/api/jobs/job-1/tasks/research/files?type=artifacts"), "job-1", "research");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, data: ["research-output.json"] });
  });

  it("reads task-owned files from the shared job files directory", async () => {
    const root = await makeTempRoot();
    process.env["PO_ROOT"] = root;
    initPATHS(root);

    const jobDir = path.join(root, "pipeline-data", "current", "job-1");
    await mkdir(path.join(jobDir, "files", "artifacts"), { recursive: true });
    await writeFile(path.join(jobDir, "files", "artifacts", "research-output.json"), '{"ok":true}\n');
    await writeFile(
      path.join(jobDir, "tasks-status.json"),
      JSON.stringify({
        id: "job-1",
        tasks: {
          research: {
            files: {
              artifacts: ["research-output.json"],
              logs: [],
              tmp: [],
            },
          },
        },
      }),
    );

    const response = await handleTaskFile(
      new Request("http://localhost/api/jobs/job-1/tasks/research/file?type=artifacts&filename=research-output.json"),
      "job-1",
      "research",
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      data: '{"ok":true}\n',
      mime: "application/json",
    });
  });

  it("rejects files not declared for the task", async () => {
    const root = await makeTempRoot();
    process.env["PO_ROOT"] = root;
    initPATHS(root);

    const jobDir = path.join(root, "pipeline-data", "current", "job-1");
    await mkdir(path.join(jobDir, "files", "artifacts"), { recursive: true });
    await writeFile(path.join(jobDir, "files", "artifacts", "other.json"), '{"ok":true}\n');
    await writeFile(
      path.join(jobDir, "tasks-status.json"),
      JSON.stringify({
        id: "job-1",
        tasks: {
          research: {
            files: {
              artifacts: ["research-output.json"],
              logs: [],
              tmp: [],
            },
          },
        },
      }),
    );

    const response = await handleTaskFile(
      new Request("http://localhost/api/jobs/job-1/tasks/research/file?type=artifacts&filename=other.json"),
      "job-1",
      "research",
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      code: "NOT_FOUND",
      message: "file not found for task: artifacts/other.json",
    });
  });
});
