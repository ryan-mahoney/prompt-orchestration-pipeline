import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  getFileReadingStats,
  readFileWithRetry,
  readJSONFile,
  readMultipleJSONFiles,
  validateFilePath,
} from "../file-reader";

const tempRoots: string[] = [];

async function makeTempRoot(): Promise<string> {
  const root = await Bun.$`mktemp -d ${path.join(os.tmpdir(), "file-reader-XXXXXX")}`.text();
  const trimmed = root.trim();
  tempRoots.push(trimmed);
  return trimmed;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => Bun.$`rm -rf ${root}`));
});

describe("file-reader", () => {
  it("reads valid json and strips a BOM", async () => {
    const root = await makeTempRoot();
    const file = path.join(root, "ok.json");
    await writeFile(file, "\uFEFF{\"ok\":true}");
    await expect(readJSONFile(file)).resolves.toEqual({ ok: true, data: { ok: true }, path: file });
  });

  it("returns structured errors for missing and invalid files", async () => {
    const root = await makeTempRoot();
    const missing = path.join(root, "missing.json");
    const invalid = path.join(root, "invalid.json");
    await writeFile(invalid, "{bad");

    await expect(readJSONFile(missing)).resolves.toMatchObject({ ok: false, code: "NOT_FOUND" });
    await expect(readJSONFile(invalid)).resolves.toMatchObject({ ok: false, code: "INVALID_JSON" });
  });

  it("rejects oversized files and reads multiples", async () => {
    const root = await makeTempRoot();
    const big = path.join(root, "big.json");
    const a = path.join(root, "a.json");
    const b = path.join(root, "b.json");
    await writeFile(big, "x".repeat(5 * 1024 * 1024 + 1));
    await writeFile(a, "{\"a\":1}");
    await writeFile(b, "{\"b\":2}");

    await expect(validateFilePath(big)).resolves.toMatchObject({ ok: false });
    const results = await readMultipleJSONFiles([a, b]);
    expect(results).toHaveLength(2);
    expect(getFileReadingStats([a, b], results)).toMatchObject({ totalFiles: 2, successCount: 2 });
  });

  it("returns immediately for missing files in retry mode", async () => {
    const root = await makeTempRoot();
    const missing = path.join(root, "missing.json");
    await expect(readFileWithRetry(missing, { maxAttempts: 10, delayMs: 1000 })).resolves.toMatchObject({
      ok: false,
      code: "NOT_FOUND",
    });
  });
});
