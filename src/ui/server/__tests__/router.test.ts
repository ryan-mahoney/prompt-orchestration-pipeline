import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { initPATHS, resetPATHS } from "../config-bridge-node";
import { createRouter } from "../router";

const tempRoots: string[] = [];

async function makeTempRoot(): Promise<string> {
  const root = await Bun.$`mktemp -d ${path.join(os.tmpdir(), "router-XXXXXX")}`.text();
  const trimmed = root.trim();
  tempRoots.push(trimmed);
  return trimmed;
}

afterEach(async () => {
  resetPATHS();
  await Promise.all(tempRoots.splice(0).map((root) => Bun.$`rm -rf ${root}`));
});

describe("router", () => {
  it("dispatches routes and falls back to spa assets", async () => {
    const root = await makeTempRoot();
    process.env["PO_ROOT"] = root;
    initPATHS(root);
    await mkdir(path.join(root, "pipeline-data", "current", "job-1"), { recursive: true });
    await writeFile(path.join(root, "pipeline-data", "current", "job-1", "tasks-status.json"), '{"id":"job-1","tasks":{}}');
    await mkdir(path.join(root, "dist"), { recursive: true });
    await writeFile(path.join(root, "dist", "index.html"), "<html>ok</html>");
    const router = createRouter({ dataDir: root, distDir: path.join(root, "dist") });

    const apiResponse = await router.handle(new Request("http://localhost/api/jobs/job-1"));
    expect(apiResponse.status).toBe(200);

    const spaResponse = await router.handle(new Request("http://localhost/unknown"));
    await expect(spaResponse.text()).resolves.toContain("<html>ok</html>");
  });
});
