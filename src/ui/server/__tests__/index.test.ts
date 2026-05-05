import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetConfig } from "../../../core/config";
import { initializeWatcher, startServer } from "../index";
import { sseRegistry } from "../sse-registry";

const tempRoots: string[] = [];

async function makeTempRoot(): Promise<string> {
  const root = await Bun.$`mktemp -d ${path.join(os.tmpdir(), "server-index-XXXXXX")}`.text();
  const trimmed = root.trim();
  tempRoots.push(trimmed);
  await mkdir(path.join(trimmed, "pipeline-data", "current", "job-1"), { recursive: true });
  await writeFile(path.join(trimmed, "pipeline-data", "current", "job-1", "tasks-status.json"), '{"id":"job-1","tasks":{}}');
  await mkdir(path.join(trimmed, "pipeline-data", "complete"), { recursive: true });
  await mkdir(path.join(trimmed, "pipeline-data", "pending"), { recursive: true });
  await mkdir(path.join(trimmed, "pipeline-data", "runtime", "running-jobs"), { recursive: true });
  await mkdir(path.join(trimmed, "pipeline-data", "runtime", "lock"), { recursive: true });
  await mkdir(path.join(trimmed, "dist"), { recursive: true });
  await writeFile(path.join(trimmed, "dist", "index.html"), "<html>ok</html>");
  return trimmed;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => Bun.$`rm -rf ${root}`));
});

async function waitForBroadcast(
  spy: ReturnType<typeof vi.spyOn>,
  predicate: (call: unknown[]) => boolean,
  timeoutMs = 3_000,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (spy.mock.calls.some((call) => predicate(call as unknown[]))) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

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

describe("initializeWatcher concurrency paths", () => {
  beforeEach(() => {
    resetConfig();
  });

  it("broadcasts when a pending seed is added", async () => {
    const root = await makeTempRoot();
    process.env["PO_ROOT"] = root;
    const spy = vi.spyOn(sseRegistry, "broadcast").mockImplementation(() => undefined);

    await initializeWatcher(root);
    await new Promise((resolve) => setTimeout(resolve, 200));
    spy.mockClear();

    await writeFile(
      path.join(root, "pipeline-data", "pending", "job-new-seed.json"),
      JSON.stringify({ name: "job-new", pipeline: "demo" }),
    );

    const seen = await waitForBroadcast(spy, (call) => call[0] === "state:summary" || call[0] === "state:change");
    expect(seen).toBe(true);

    spy.mockRestore();
  });

  it("broadcasts when a running-jobs lease file is added", async () => {
    const root = await makeTempRoot();
    process.env["PO_ROOT"] = root;
    const spy = vi.spyOn(sseRegistry, "broadcast").mockImplementation(() => undefined);

    await initializeWatcher(root);
    await new Promise((resolve) => setTimeout(resolve, 200));
    spy.mockClear();

    await writeFile(
      path.join(root, "pipeline-data", "runtime", "running-jobs", "job-active.json"),
      JSON.stringify({ jobId: "job-active", pid: 1234, acquiredAt: new Date().toISOString(), source: "orchestrator" }),
    );

    const seen = await waitForBroadcast(spy, (call) => call[0] === "state:summary" || call[0] === "state:change");
    expect(seen).toBe(true);

    spy.mockRestore();
  });

  it("does not broadcast on lock-directory churn", async () => {
    const root = await makeTempRoot();
    process.env["PO_ROOT"] = root;
    const spy = vi.spyOn(sseRegistry, "broadcast").mockImplementation(() => undefined);

    await initializeWatcher(root);
    await new Promise((resolve) => setTimeout(resolve, 200));
    spy.mockClear();

    const lockDir = path.join(root, "pipeline-data", "runtime", "lock");
    for (let i = 0; i < 5; i++) {
      await rm(lockDir, { recursive: true, force: true });
      await mkdir(lockDir, { recursive: true });
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));

    const stateBroadcasts = spy.mock.calls.filter(
      (call) => call[0] === "state:summary" || call[0] === "state:change",
    );
    expect(stateBroadcasts).toHaveLength(0);

    spy.mockRestore();
  });
});
