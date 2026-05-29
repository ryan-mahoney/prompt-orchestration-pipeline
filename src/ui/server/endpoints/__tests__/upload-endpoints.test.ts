import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { normalizeSeedUpload } from "../upload-endpoints";

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
