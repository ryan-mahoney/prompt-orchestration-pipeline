import { unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { parseMultipartFormData, readRawBody, sendJson } from "../utils/http-utils";
import { getMimeType, isTextMime } from "../utils/mime-types";
import { ensureUniqueSlug, generateSlug } from "../utils/slug";

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

describe("server utils", () => {
  it("sends json responses", async () => {
    const response = sendJson(200, { ok: true });
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/json");
    await expect(response.text()).resolves.toBe('{"ok":true}');
  });

  it("enforces raw body limits", async () => {
    const request = new Request("http://localhost", {
      method: "POST",
      body: "hello",
    });
    await expect(readRawBody(request, 2)).rejects.toThrow(/exceeds/);
  });

  it("parses multipart payloads", async () => {
    const boundary = "boundary";
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="meta"',
      "",
      "value",
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="seed.json"',
      "Content-Type: application/json",
      "",
      '{"ok":true}',
      `--${boundary}--`,
      "",
    ].join("\r\n");
    const request = new Request("http://localhost", {
      method: "POST",
      headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
      body,
    });

    const parsed = await parseMultipartFormData(request);
    expect(parsed.fields).toEqual({ meta: "value" });
    expect(parsed.files[0]).toMatchObject({ filename: "seed.json", contentType: "application/json" });
  });

  it("preserves binary zip payloads byte-for-byte", async () => {
    const seed = { name: "binary-seed" };
    const binary = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
      binary[i] = i;
    }
    const zip = zipSync({
      "seed.json": new TextEncoder().encode(JSON.stringify(seed)),
      "data.bin": binary,
    });

    const boundary = "binaryboundary";
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

    const parsed = await parseMultipartFormData(request);

    // AC1: byte-for-byte identical recovery.
    const file = parsed.files[0]!;
    expect(file.content.length).toBe(zip.length);
    expect(Array.from(file.content)).toEqual(Array.from(zip));

    // AC2: recovered bytes unzip and include seed.json.
    const extracted = unzipSync(file.content);
    expect(Object.keys(extracted)).toContain("seed.json");
  });

  it("routes string fields and preserves text file metadata", async () => {
    const boundary = "mixedboundary";
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="meta"',
      "",
      "value",
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="seed.json"',
      "Content-Type: application/json",
      "",
      '{"ok":true}',
      `--${boundary}--`,
      "",
    ].join("\r\n");
    const request = new Request("http://localhost", {
      method: "POST",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      body,
    });

    const parsed = await parseMultipartFormData(request);

    // AC4: a part without a filename is returned under fields.
    expect(parsed.fields).toEqual({ meta: "value" });

    // AC5: a .json file part preserves filename and contentType.
    expect(parsed.files[0]).toMatchObject({
      filename: "seed.json",
      contentType: "application/json",
    });
  });

  it("rejects non-multipart content types", async () => {
    const request = new Request("http://localhost", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"ok":true}',
    });

    // AC6: non-multipart content type throws.
    await expect(parseMultipartFormData(request)).rejects.toThrow(/multipart/);
  });

  it("rejects multipart content types without a boundary", async () => {
    const request = new Request("http://localhost", {
      method: "POST",
      headers: { "content-type": "multipart/form-data" },
      body: "irrelevant",
    });

    await expect(parseMultipartFormData(request)).rejects.toThrow(/boundary/);
  });

  it("enforces the multipart byte cap", async () => {
    const boundary = "capboundary";
    const encoder = new TextEncoder();
    const body = concatBytes([
      encoder.encode(
        `--${boundary}\r\n` +
          'Content-Disposition: form-data; name="file"; filename="big.bin"\r\n' +
          "Content-Type: application/octet-stream\r\n\r\n",
      ),
      new Uint8Array(1024),
      encoder.encode(`\r\n--${boundary}--\r\n`),
    ]);

    const request = new Request("http://localhost", {
      method: "POST",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      body,
    });

    // AC7: a body larger than the passed maxBytes throws.
    await expect(parseMultipartFormData(request, 64)).rejects.toThrow(/exceeds/);
  });

  it("maps mime types and text classification", () => {
    expect(getMimeType("file.json")).toBe("application/json");
    expect(getMimeType("file.unknown")).toBe("application/octet-stream");
    expect(isTextMime("text/plain")).toBe(true);
    expect(isTextMime("image/png")).toBe(false);
  });

  it("generates and de-duplicates slugs", () => {
    expect(generateSlug("My Pipeline Name!")).toBe("my-pipeline-name");
    expect(generateSlug("x".repeat(60)).length).toBeLessThanOrEqual(47);
    expect(ensureUniqueSlug("test", new Set(["test"]))).toBe("test-2");
    expect(ensureUniqueSlug("test", new Set(["test", "test-2"]))).toBe("test-3");
  });
});
