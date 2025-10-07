import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

/**
 * Creates a temporary pipeline directory structure for testing
 * @returns {Promise<string>} Path to the temporary pipeline root directory
 */
export async function createTempPipelineDir() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pipeline-test-"));

  // Create the pipeline data directory structure
  const pipelineDataDir = path.join(tempDir, "pipeline-data");
  await fs.mkdir(path.join(pipelineDataDir, "pending"), { recursive: true });
  await fs.mkdir(path.join(pipelineDataDir, "current"), { recursive: true });
  await fs.mkdir(path.join(pipelineDataDir, "complete"), { recursive: true });

  return pipelineDataDir;
}

export async function createTempDir() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pipeline-test-"));

  // Create the pipeline data directory structure
  const pipelineDataDir = path.join(tempDir, "pipeline-data");
  await fs.mkdir(path.join(pipelineDataDir, "pending"), { recursive: true });
  await fs.mkdir(path.join(pipelineDataDir, "current"), { recursive: true });
  await fs.mkdir(path.join(pipelineDataDir, "complete"), { recursive: true });

  return tempDir;
}
