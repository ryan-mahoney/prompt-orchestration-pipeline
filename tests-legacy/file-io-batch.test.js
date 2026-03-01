import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createTaskFileIO } from "../src/core/file-io.js";
import { createTempDir, cleanupTempDir } from "./test-utils.js";

describe("createTaskFileIO.runBatch", () => {
  let tempDir;
  let workDir;
  let statusPath;
  let taskName;
  let getStage;
  let fileIO;

  beforeEach(async () => {
    tempDir = await createTempDir();
    workDir = path.join(tempDir, "work");
    statusPath = path.join(workDir, "tasks-status.json");
    taskName = "test-task";
    getStage = vi.fn(() => "test-stage");

    const initialStatus = {
      id: "test-job",
      name: "test-pipeline",
      createdAt: new Date().toISOString(),
      state: "running",
      tasks: {
        [taskName]: {
          state: "running",
          startedAt: new Date().toISOString(),
        },
      },
      current: taskName,
    };

    await fs.mkdir(workDir, { recursive: true });
    await fs.writeFile(statusPath, JSON.stringify(initialStatus, null, 2));

    fileIO = createTaskFileIO({
      workDir,
      taskName,
      getStage,
      statusPath,
    });
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
    vi.restoreAllMocks();
  });

  it("executes batch and returns results", async () => {
    const jobs = [
      { id: "job-1", value: 10 },
      { id: "job-2", value: 20 },
      { id: "job-3", value: 30 },
    ];
    const processor = async (input) => input.value * 2;

    const result = await fileIO.runBatch({ jobs, processor });

    expect(result.completed).toHaveLength(3);
    expect(result.failed).toHaveLength(0);

    const outputs = result.completed.map((c) => c.output);
    expect(outputs).toContain(20);
    expect(outputs).toContain(40);
    expect(outputs).toContain(60);
  });
});
