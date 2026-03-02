import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { startServer } from "../index";

const tempRoots: string[] = [];

async function makeTempRoot(): Promise<string> {
  const root = await Bun.$`mktemp -d ${path.join(os.tmpdir(), "server-index-XXXXXX")}`.text();
  const trimmed = root.trim();
  tempRoots.push(trimmed);
  await mkdir(path.join(trimmed, "pipeline-data", "current", "job-1"), { recursive: true });
  await writeFile(path.join(trimmed, "pipeline-data", "current", "job-1", "tasks-status.json"), '{"id":"job-1","tasks":{}}');
  await mkdir(path.join(trimmed, "dist"), { recursive: true });
  await writeFile(path.join(trimmed, "dist", "index.html"), "<html>ok</html>");
  return trimmed;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => Bun.$`rm -rf ${root}`));
});

describe("server index", () => {
  it("starts and responds to requests", async () => {
    const root = await makeTempRoot();
    process.env["PO_ROOT"] = root;
    const handle = await startServer({ dataDir: root, port: 4111 });
    expect(handle.url).toBe("http://localhost:4111");
    const response = await fetch(`${handle.url}/api/jobs/job-1`);
    expect(response.status).toBe(200);
    await handle.close();
  });
});
