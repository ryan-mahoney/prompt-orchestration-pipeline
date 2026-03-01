import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

describe("check-name-based-paths script", () => {
  let tempDir;
  let scriptPath;

  beforeEach(async () => {
    // Create a temporary directory for test files
    tempDir = await fs.mkdtemp(path.join(process.cwd(), "test-check-script-"));
    scriptPath = path.join(process.cwd(), "scripts/check-name-based-paths.sh");
  });

  afterEach(async () => {
    // Clean up temporary directory
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("should exit with 0 when no forbidden patterns are found", async () => {
    // Create clean files with no forbidden patterns
    await fs.writeFile(
      path.join(tempDir, "clean.js"),
      "const jobId = 'abc123';"
    );
    await fs.writeFile(
      path.join(tempDir, "clean.md"),
      "# This is clean documentation"
    );

    const result = execSync(`${scriptPath}`, {
      cwd: tempDir,
      encoding: "utf8",
      env: { ...process.env, SEARCH_DIRS: "." },
    });

    expect(result).toContain("✅ No forbidden patterns found");
    expect(result).toContain("ID-only storage invariant is preserved");
  });

  it("should exit with 1 when current/{name} pattern is found", async () => {
    // Create file with forbidden pattern
    await fs.writeFile(
      path.join(tempDir, "bad.js"),
      "const path = 'current/{name}/seed.json';"
    );

    try {
      execSync(`${scriptPath}`, {
        cwd: tempDir,
        encoding: "utf8",
        env: { ...process.env, SEARCH_DIRS: "." },
      });
      expect.fail("Script should have exited with error");
    } catch (error) {
      expect(error.status).toBe(1);
      expect(error.stdout).toContain(
        "❌ FORBIDDEN PATTERN FOUND: current/{name}"
      );
      expect(error.stdout).toContain("REGRESSION DETECTED");
    }
  });

  it("should exit with 1 when current/<name> pattern is found", async () => {
    // Create file with forbidden pattern
    await fs.writeFile(
      path.join(tempDir, "bad.js"),
      "const path = 'current/<name>/seed.json';"
    );

    try {
      execSync(`${scriptPath}`, {
        cwd: tempDir,
        encoding: "utf8",
        env: { ...process.env, SEARCH_DIRS: "." },
      });
      expect.fail("Script should have exited with error");
    } catch (error) {
      expect(error.status).toBe(1);
      expect(error.stdout).toContain(
        "❌ FORBIDDEN PATTERN FOUND: current/<name>"
      );
      expect(error.stdout).toContain("REGRESSION DETECTED");
    }
  });

  it("should exit with 1 when -seed.json.*name pattern is found", async () => {
    // Create file with forbidden pattern
    await fs.writeFile(
      path.join(tempDir, "bad.js"),
      "const filename = `${jobName}-seed.json`;"
    );

    try {
      execSync(`${scriptPath}`, {
        cwd: tempDir,
        encoding: "utf8",
        env: { ...process.env, SEARCH_DIRS: "." },
      });
      expect.fail("Script should have exited with error");
    } catch (error) {
      expect(error.status).toBe(1);
      expect(error.stdout).toContain(
        "❌ FORBIDDEN PATTERN FOUND: jobName.*-seed\\.json"
      );
      expect(error.stdout).toContain("REGRESSION DETECTED");
    }
  });

  it("should find patterns in different file types", async () => {
    // Create files with forbidden patterns in different extensions
    await fs.writeFile(
      path.join(tempDir, "bad.js"),
      "const path = 'current/{name}/seed.json';"
    );
    await fs.writeFile(
      path.join(tempDir, "bad.md"),
      "The file goes to current/<name>/directory"
    );
    await fs.writeFile(
      path.join(tempDir, "bad.json"),
      '{"path": "current/{name}/data"}'
    );

    try {
      execSync(`${scriptPath}`, {
        cwd: tempDir,
        encoding: "utf8",
        env: { ...process.env, SEARCH_DIRS: "." },
      });
      expect.fail("Script should have exited with error");
    } catch (error) {
      expect(error.status).toBe(1);
      // Should find multiple patterns across different files
      expect(error.stdout).toContain("FORBIDDEN PATTERN FOUND");
      expect(
        error.stdout.split("FORBIDDEN PATTERN FOUND").length
      ).toBeGreaterThan(2);
    }
  });

  it("should not find false positives in legitimate code", async () => {
    // Create files with similar but legitimate patterns
    await fs.writeFile(
      path.join(tempDir, "legitimate.js"),
      `
const jobId = 'abc123';
const currentDir = 'current';
const fileName = 'seed.json';
const fullName = 'John Doe';
const template = 'current/{id}/seed.json';
const validPath = 'current/job-id-123/seed.json';
      `
    );

    const result = execSync(`${scriptPath}`, {
      cwd: tempDir,
      encoding: "utf8",
      env: { ...process.env, SEARCH_DIRS: "." },
    });

    expect(result).toContain("✅ No forbidden patterns found");
  });

  it("should handle empty directories gracefully", async () => {
    // Don't create any files, just run the script
    const result = execSync(`${scriptPath}`, {
      cwd: tempDir,
      encoding: "utf8",
      env: { ...process.env, SEARCH_DIRS: "." },
    });

    expect(result).toContain("✅ No forbidden patterns found");
  });

  it("should search only specified directories", async () => {
    // Create directory structure
    const searchDir = path.join(tempDir, "src");
    const ignoreDir = path.join(tempDir, "node_modules");
    await fs.mkdir(searchDir);
    await fs.mkdir(ignoreDir);

    // Put bad pattern in search directory
    await fs.writeFile(
      path.join(searchDir, "bad.js"),
      "const path = 'current/{name}/seed.json';"
    );

    // Put bad pattern in ignored directory
    await fs.writeFile(
      path.join(ignoreDir, "bad.js"),
      "const path = 'current/{name}/seed.json';"
    );

    try {
      execSync(`${scriptPath}`, {
        cwd: tempDir,
        encoding: "utf8",
        env: { ...process.env, SEARCH_DIRS: "src" },
      });
      expect.fail("Script should have exited with error");
    } catch (error) {
      expect(error.status).toBe(1);
      expect(error.stdout).toContain("FORBIDDEN PATTERN FOUND");
      // Should find pattern in src but not in node_modules
      expect(error.stdout).toContain("src/bad.js");
      expect(error.stdout).not.toContain("node_modules");
    }
  });

  it("should provide helpful error message with documentation reference", async () => {
    await fs.writeFile(
      path.join(tempDir, "bad.js"),
      "const path = 'current/{name}/seed.json';"
    );

    try {
      execSync(`${scriptPath}`, {
        cwd: tempDir,
        encoding: "utf8",
        env: { ...process.env, SEARCH_DIRS: "." },
      });
      expect.fail("Script should have exited with error");
    } catch (error) {
      expect(error.status).toBe(1);
      expect(error.stdout).toContain(
        "Please remove these patterns and use ID-only paths instead"
      );
      expect(error.stdout).toContain(
        "Refer to docs/storage.md for the correct ID-only patterns"
      );
    }
  });
});
