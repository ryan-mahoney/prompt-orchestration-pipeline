import { readdir } from "node:fs/promises";
import { join, basename } from "node:path";
import { createJobLogger } from "./logger";
import type { StatusSnapshot } from "./status-writer";

interface PipelineDescriptor {
  tasks: Array<{ id: string; [key: string]: unknown }>;
  [key: string]: unknown;
}

type ArtifactApplyFn = (snapshot: StatusSnapshot) => StatusSnapshot;

export async function initializeStatusFromArtifacts({
  jobDir,
  pipeline,
}: {
  jobDir: string;
  pipeline: PipelineDescriptor;
}): Promise<ArtifactApplyFn> {
  if (typeof jobDir !== "string" || jobDir.length === 0) {
    throw new Error("jobDir must be a non-empty string");
  }
  if (typeof pipeline !== "object" || pipeline === null) {
    throw new Error("pipeline must be an object");
  }

  const jobId = basename(jobDir);
  const logger = createJobLogger("status-initializer", jobId);
  const artifactsDir = join(jobDir, "files", "artifacts");

  let filenames: string[];
  try {
    filenames = await readdir(artifactsDir);
    logger.log(`Discovered ${filenames.length} artifact(s)`, { artifactsDir });
  } catch (err) {
    logger.warn("Could not read artifacts directory, returning no-op", err);
    return (snapshot) => snapshot;
  }

  const firstTask = pipeline.tasks[0];
  const firstTaskId = firstTask && typeof firstTask.id === "string" ? firstTask.id : null;

  return (snapshot) => {
    if (!Array.isArray(snapshot.files.artifacts)) {
      snapshot.files.artifacts = [];
    }
    const globalSet = new Set(snapshot.files.artifacts);
    for (const f of filenames) globalSet.add(f);
    snapshot.files.artifacts = Array.from(globalSet);

    if (firstTaskId !== null) {
      if (!snapshot.tasks[firstTaskId]) {
        snapshot.tasks[firstTaskId] = {};
      }
      const task = snapshot.tasks[firstTaskId]!;
      if (!task.files) {
        task.files = { artifacts: [], logs: [], tmp: [] };
      }
      if (!Array.isArray(task.files.artifacts)) {
        task.files.artifacts = [];
      }
      const taskSet = new Set(task.files.artifacts);
      for (const f of filenames) taskSet.add(f);
      task.files.artifacts = Array.from(taskSet);
    }

    return snapshot;
  };
}
