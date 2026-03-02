import { describe, test, expect, mock } from "bun:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

mock.module("../../src/core/logger", () => ({
  createJobLogger: (_component: string, _jobId: string) => ({
    debug: mock(() => {}),
    log: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
    group: mock(() => {}),
    groupEnd: mock(() => {}),
    sse: mock(() => {}),
  }),
  createLogger: () => ({
    debug: mock(() => {}),
    log: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
    group: mock(() => {}),
    groupEnd: mock(() => {}),
    sse: mock(() => {}),
  }),
}));

import { initializeStatusFromArtifacts } from "../../src/core/status-initializer";
import type { StatusSnapshot } from "../../src/core/status-writer";

function makeSnapshot(overrides: Partial<StatusSnapshot> = {}): StatusSnapshot {
  return {
    id: "test-job",
    state: "pending",
    current: null,
    currentStage: null,
    lastUpdated: new Date().toISOString(),
    tasks: {},
    files: { artifacts: [], logs: [], tmp: [] },
    ...overrides,
  };
}

async function makeJobDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "status-init-test-"));
}

async function createArtifactsDir(jobDir: string, files: string[]): Promise<void> {
  const dir = join(jobDir, "files", "artifacts");
  await mkdir(dir, { recursive: true });
  for (const f of files) {
    await writeFile(join(dir, f), "");
  }
}

describe("initializeStatusFromArtifacts", () => {
  test("(1) populates snapshot.files.artifacts and task artifacts from discovered files", async () => {
    const jobDir = await makeJobDir();
    await createArtifactsDir(jobDir, ["file1.txt", "file2.txt"]);

    const pipeline = { tasks: [{ id: "task-a" }] };
    const apply = await initializeStatusFromArtifacts({ jobDir, pipeline });

    const snapshot = makeSnapshot({ tasks: { "task-a": {} } });
    const result = apply(snapshot);

    expect(result.files.artifacts).toContain("file1.txt");
    expect(result.files.artifacts).toContain("file2.txt");
    expect(result.tasks["task-a"]!.files!.artifacts).toContain("file1.txt");
    expect(result.tasks["task-a"]!.files!.artifacts).toContain("file2.txt");
  });

  test("(2) returns no-op when artifacts directory does not exist", async () => {
    const jobDir = await makeJobDir();
    const pipeline = { tasks: [{ id: "task-a" }] };
    const apply = await initializeStatusFromArtifacts({ jobDir, pipeline });

    const snapshot = makeSnapshot();
    const result = apply(snapshot);

    expect(result).toBe(snapshot);
    expect(result.files.artifacts).toHaveLength(0);
  });

  test("(3) deduplicates filenames when applied twice to same snapshot", async () => {
    const jobDir = await makeJobDir();
    await createArtifactsDir(jobDir, ["a.txt", "b.txt"]);

    const pipeline = { tasks: [{ id: "task-a" }] };
    const apply = await initializeStatusFromArtifacts({ jobDir, pipeline });

    const snapshot = makeSnapshot({ tasks: { "task-a": {} } });
    apply(snapshot);
    apply(snapshot);

    const unique = new Set(snapshot.files.artifacts);
    expect(unique.size).toBe(snapshot.files.artifacts.length);
    expect(snapshot.files.artifacts).toHaveLength(2);
  });

  test("(4) throws when jobDir is invalid", async () => {
    await expect(
      // @ts-expect-error — intentional invalid input
      initializeStatusFromArtifacts({ jobDir: "", pipeline: { tasks: [] } })
    ).rejects.toThrow("jobDir must be a non-empty string");

    await expect(
      // @ts-expect-error — intentional invalid input
      initializeStatusFromArtifacts({ jobDir: 123, pipeline: { tasks: [] } })
    ).rejects.toThrow("jobDir must be a non-empty string");
  });

  test("(5) throws when pipeline is invalid", async () => {
    const jobDir = await makeJobDir();
    await expect(
      // @ts-expect-error — intentional invalid input
      initializeStatusFromArtifacts({ jobDir, pipeline: null })
    ).rejects.toThrow("pipeline must be an object");

    await expect(
      // @ts-expect-error — intentional invalid input
      initializeStatusFromArtifacts({ jobDir, pipeline: "bad" })
    ).rejects.toThrow("pipeline must be an object");
  });

  test("(6) populates snapshot.files.artifacts but skips task artifacts when pipeline.tasks is empty", async () => {
    const jobDir = await makeJobDir();
    await createArtifactsDir(jobDir, ["x.txt"]);

    const apply = await initializeStatusFromArtifacts({ jobDir, pipeline: { tasks: [] } });

    const snapshot = makeSnapshot();
    const result = apply(snapshot);

    expect(result.files.artifacts).toContain("x.txt");
    expect(Object.keys(result.tasks)).toHaveLength(0);
  });

  test("(7) skips task-level population when first task has no string id", async () => {
    const jobDir = await makeJobDir();
    await createArtifactsDir(jobDir, ["y.txt"]);

    const pipeline = { tasks: [{ name: "no-id" } as unknown as { id: string }] };
    const apply = await initializeStatusFromArtifacts({ jobDir, pipeline });

    const snapshot = makeSnapshot();
    const result = apply(snapshot);

    expect(result.files.artifacts).toContain("y.txt");
    expect(Object.keys(result.tasks)).toHaveLength(0);
  });
});
