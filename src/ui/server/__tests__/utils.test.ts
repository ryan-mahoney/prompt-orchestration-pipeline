import { describe, expect, it } from "vitest";

import { parseMultipartFormData, readRawBody, sendJson } from "../utils/http-utils";
import { getMimeType, isTextMime } from "../utils/mime-types";
import { ensureUniqueSlug, generateSlug } from "../utils/slug";

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
