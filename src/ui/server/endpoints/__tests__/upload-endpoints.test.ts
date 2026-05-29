import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { handleSeedUploadDirect, normalizeSeedUpload } from "../upload-endpoints";

async function pathExists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

function concatBytes(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

describe("normalizeSeedUpload", () => {
  it("extracts seed and binary artifact from a multipart zip upload", async () => {
    const seed = { name: "demo", pipeline: "x" };
    const artifact = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
      artifact[i] = i;
    }
    const zip = zipSync({
      "seed.json": new TextEncoder().encode(JSON.stringify(seed)),
      "artifacts/blob.bin": artifact,
    });

    const boundary = "uploadboundary";
    const encoder = new TextEncoder();
    const header = encoder.encode(
      `--${boundary}\r\n` +
        'Content-Disposition: form-data; name="file"; filename="bundle.zip"\r\n' +
        "Content-Type: application/zip\r\n\r\n",
    );
    const footer = encoder.encode(`\r\n--${boundary}--\r\n`);
    const body = concatBytes([header, zip, footer]);

    const request = new Request("http://localhost", {
      method: "POST",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      body,
    });

    const result = await normalizeSeedUpload(request);

    // AC3: seedObject deep-equals the original seed.
    expect(result.seedObject).toEqual(seed);

    // AC3: exactly one artifact, byte-identical to the source blob.
    expect(result.artifacts).toHaveLength(1);
    const blob = result.artifacts![0]!;
    expect(blob.filename).toBe("artifacts/blob.bin");
    expect(blob.content.length).toBe(artifact.length);
    expect(Array.from(blob.content)).toEqual(Array.from(artifact));
  });
});

describe("handleSeedUploadDirect", () => {
  it("stages artifacts under staging/{jobId}/ without creating current/{jobId}/", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "upload-direct-"));
    try {
      const content = new TextEncoder().encode("# notes\nhello\n");
      const seedObject = { name: "demo", pipeline: "x" };

      const response = await handleSeedUploadDirect(seedObject, dataDir, [
        { filename: "notes.md", content },
      ]);
      expect(response.status).toBe(201);
      const body = (await response.json()) as { data: { jobId: string } };
      const jobId = body.data.jobId;

      const pipelineData = path.join(dataDir, "pipeline-data");

      // Artifact staged byte-identical under staging/{jobId}/.
      const staged = path.join(pipelineData, "staging", jobId, "notes.md");
      const stagedBytes = await readFile(staged);
      expect(Array.from(stagedBytes)).toEqual(Array.from(content));

      // Pending seed trigger written.
      expect(await pathExists(path.join(pipelineData, "pending", `${jobId}-seed.json`))).toBe(true);

      // The endpoint must not create current/{jobId}/.
      expect(await pathExists(path.join(pipelineData, "current", jobId))).toBe(false);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});
