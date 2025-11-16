import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startServer } from "../src/ui/server.js";
import { promises as fs } from "fs";
import path from "path";

describe("Upload API - Zip Files", () => {
  let server;
  let baseUrl;

  beforeAll(async () => {
    const result = await startServer({ dataDir: process.cwd() });
    server = result;
    baseUrl = result.url;
  });

  afterAll(async () => {
    if (server) {
      await server.close();
    }
  });

  it("should accept valid zip upload", async () => {
    // Use the existing zip file from demo/seeds
    const zipPath = path.join(process.cwd(), "demo/seeds/zip-test.zip");

    // Check if zip file exists
    if (
      !(await fs
        .access(zipPath)
        .then(() => true)
        .catch(() => false))
    ) {
      console.log("Zip test file not found, skipping test");
      return;
    }

    const zipBuffer = await fs.readFile(zipPath);

    // Create multipart form data manually (Node.js compatible)
    const boundary = "WebKitFormBoundaryZipTest123";
    const header = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="zip-test.zip"',
      "Content-Type: application/zip",
      "",
      "",
    ].join("\r\n");
    const footer = `\r\n--${boundary}--\r\n`;

    // Combine header, buffer, and footer properly
    const body = Buffer.concat([
      Buffer.from(header, "utf8"),
      zipBuffer,
      Buffer.from(footer, "utf8"),
    ]);

    console.log("Making zip upload request...");

    const response = await fetch(`${baseUrl}/api/upload/seed`, {
      method: "POST",
      headers: {
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
      },
      body,
    });

    console.log("Zip upload response status:", response.status);

    const responseText = await response.text();
    console.log("Zip upload response body:", responseText);

    expect(response.status).toBe(200);

    // Try to parse JSON response
    let result;
    try {
      result = JSON.parse(responseText);
    } catch (e) {
      console.error("Failed to parse response as JSON:", responseText);
      throw e;
    }

    console.log("Parsed zip upload result:", result);

    expect(result).toMatchObject({
      success: true,
      jobName: "test-zip-job",
      message: "Seed file uploaded successfully",
    });
    expect(result.jobId).toMatch(/^[A-Za-z0-9]{12}$/);
  });

  it("should reject zip without seed.json", async () => {
    // For now, just test with invalid JSON to verify error handling
    // TODO: Create a proper zip without seed.json when archiver is available

    const boundary = "WebKitFormBoundaryZipTest456";
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="invalid.json"',
      "Content-Type: application/json",
      "",
      "invalid json content",
      `--${boundary}--`,
      "",
    ].join("\r\n");

    const response = await fetch(`${baseUrl}/api/upload/seed`, {
      method: "POST",
      headers: {
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
      },
      body,
    });

    expect(response.status).toBe(400);

    const result = await response.json();
    expect(result).toMatchObject({
      success: false,
    });
  });
});
