import { mkdir } from "node:fs/promises";
import path from "node:path";

import { parseMultipartFormData, sendJson } from "../utils/http-utils";
import { extractSeedZip } from "../zip-utils";

export interface SeedUploadResult {
  seedObject: Record<string, unknown>;
  artifacts?: Array<{ filename: string; content: Uint8Array }>;
}

function nextJobId(): string {
  return `job-${Date.now()}`;
}

export async function normalizeSeedUpload(req: Request): Promise<SeedUploadResult> {
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return { seedObject: (await req.json()) as Record<string, unknown> };
  }

  const multipart = await parseMultipartFormData(req);
  const file = multipart.files[0];
  if (!file) throw new Error("upload requires a file");
  if (file.filename.endsWith(".zip")) return extractSeedZip(file.content);
  return { seedObject: JSON.parse(new TextDecoder().decode(file.content)) as Record<string, unknown> };
}

export async function handleSeedUploadDirect(
  seedObject: Record<string, unknown>,
  dataDir: string,
  artifacts: Array<{ filename: string; content: Uint8Array }> = [],
): Promise<Response> {
  const jobId = nextJobId();
  const pipelineData = path.join(dataDir, "pipeline-data");
  const pendingDir = path.join(pipelineData, "pending");

  // Write artifacts to current/{jobId}/ first (before the trigger file)
  // so they are in place when the orchestrator processes the seed.
  if (artifacts.length > 0) {
    const jobDir = path.join(pipelineData, "current", jobId);
    for (const artifact of artifacts) {
      const artifactPath = path.join(jobDir, "files", "artifacts", artifact.filename);
      await mkdir(path.dirname(artifactPath), { recursive: true });
      await Bun.write(artifactPath, artifact.content);
    }
  }

  // Write the seed to pending/ as the trigger file for the orchestrator.
  // The orchestrator watches pending/*.json and handles the full lifecycle:
  // move to current/, write tasks-status.json, and spawn the pipeline runner.
  await mkdir(pendingDir, { recursive: true });
  await Bun.write(
    path.join(pendingDir, `${jobId}-seed.json`),
    JSON.stringify(seedObject, null, 2),
  );

  return sendJson(201, { ok: true, data: { jobId } });
}

export async function handleSeedUpload(req: Request, dataDir: string): Promise<Response> {
  const upload = await normalizeSeedUpload(req);
  return handleSeedUploadDirect(upload.seedObject, dataDir, upload.artifacts);
}
