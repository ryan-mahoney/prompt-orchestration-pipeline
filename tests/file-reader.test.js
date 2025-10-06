/**
 * Tests for file-reader.js
 * @module file-reader.test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  readJSONFile,
  readFileWithRetry,
  readMultipleJSONFiles,
  validateFilePath,
  getFileReadingStats,
} from "../src/ui/file-reader.js";
import { createJobTree } from "./test-data-utils.js";
import { promises as fs } from "node:fs";
import path from "node:path";

describe("file-reader", () => {
  describe("readJSONFile", () => {
    let jobTree;
    let testFilePath;

    beforeEach(async () => {
      jobTree = await createJobTree({ jobId: "test-reader" });
      testFilePath = path.join(jobTree.jobDir, "test-file.json");
    });

    afterEach(async () => {
      if (jobTree) {
        await jobTree.cleanup();
      }
    });

    it("should read valid JSON file", async () => {
      const testData = { name: "test", value: 42, nested: { key: "value" } };
      await fs.writeFile(testFilePath, JSON.stringify(testData));

      const result = await readJSONFile(testFilePath);

      expect(result.ok).toBe(true);
      expect(result.data).toEqual(testData);
      expect(result.path).toBe(testFilePath);
    });

    it("should handle UTF-8 BOM", async () => {
      const testData = { name: "test" };
      const contentWithBOM = "\uFEFF" + JSON.stringify(testData);
      await fs.writeFile(testFilePath, contentWithBOM);

      const result = await readJSONFile(testFilePath);

      expect(result.ok).toBe(true);
      expect(result.data).toEqual(testData);
    });

    it("should return not_found for missing file", async () => {
      const result = await readJSONFile("/non/existent/file.json");

      expect(result.ok).toBe(false);
      expect(result.code).toBe("not_found");
      expect(result.message).toBe("File not found");
    });

    it("should return invalid_json for malformed JSON", async () => {
      await fs.writeFile(testFilePath, "{ invalid json }");

      const result = await readJSONFile(testFilePath);

      expect(result.ok).toBe(false);
      expect(result.code).toBe("invalid_json");
      expect(result.message).toContain("Invalid JSON");
    });

    it("should return fs_error for file too large", async () => {
      // Create a large file (exceeds 5MB limit)
      const largeContent = "x".repeat(6 * 1024 * 1024); // 6MB
      await fs.writeFile(testFilePath, largeContent);

      const result = await readJSONFile(testFilePath);

      expect(result.ok).toBe(false);
      expect(result.code).toBe("fs_error");
      expect(result.message).toContain("File too large");
    });

    it("should return fs_error for permission denied", async () => {
      const mockStat = vi
        .spyOn(fs, "stat")
        .mockRejectedValue(new Error("Permission denied"));

      const result = await readJSONFile(testFilePath);

      expect(result.ok).toBe(false);
      expect(result.code).toBe("fs_error");
      expect(result.message).toContain("Permission denied");

      mockStat.mockRestore();
    });

    it("should handle generic file system errors", async () => {
      const mockStat = vi
        .spyOn(fs, "stat")
        .mockRejectedValue(new Error("Unknown error"));

      const result = await readJSONFile(testFilePath);

      expect(result.ok).toBe(false);
      expect(result.code).toBe("fs_error");
      expect(result.message).toContain("File system error");

      mockStat.mockRestore();
    });
  });

  describe("readFileWithRetry", () => {
    let jobTree;
    let testFilePath;

    beforeEach(async () => {
      jobTree = await createJobTree({ jobId: "test-retry" });
      testFilePath = path.join(jobTree.jobDir, "test-retry.json");
    });

    afterEach(async () => {
      if (jobTree) {
        await jobTree.cleanup();
      }
    });

    it("should succeed on first attempt with valid JSON", async () => {
      const testData = { success: true };
      await fs.writeFile(testFilePath, JSON.stringify(testData));

      const result = await readFileWithRetry(testFilePath);

      expect(result.ok).toBe(true);
      expect(result.data).toEqual(testData);
    });

    it("should handle file not found errors", async () => {
      const result = await readFileWithRetry("/non/existent/file.json", {
        maxAttempts: 2,
        delayMs: 10,
      });

      expect(result.ok).toBe(false);
      expect(result.code).toBe("not_found");
    });
  });

  describe("readMultipleJSONFiles", () => {
    let jobTree;
    let filePaths;

    beforeEach(async () => {
      jobTree = await createJobTree({ jobId: "test-multiple" });
      filePaths = [
        path.join(jobTree.jobDir, "file1.json"),
        path.join(jobTree.jobDir, "file2.json"),
        path.join(jobTree.jobDir, "file3.json"),
      ];
    });

    afterEach(async () => {
      if (jobTree) {
        await jobTree.cleanup();
      }
    });

    it("should read multiple files successfully", async () => {
      const testData1 = { file: 1 };
      const testData2 = { file: 2 };
      const testData3 = { file: 3 };

      await fs.writeFile(filePaths[0], JSON.stringify(testData1));
      await fs.writeFile(filePaths[1], JSON.stringify(testData2));
      await fs.writeFile(filePaths[2], JSON.stringify(testData3));

      const results = await readMultipleJSONFiles(filePaths);

      expect(results).toHaveLength(3);
      expect(results[0].ok).toBe(true);
      expect(results[0].data).toEqual(testData1);
      expect(results[1].ok).toBe(true);
      expect(results[1].data).toEqual(testData2);
      expect(results[2].ok).toBe(true);
      expect(results[2].data).toEqual(testData3);
    });

    it("should handle mixed success and failure", async () => {
      const testData1 = { file: 1 };
      await fs.writeFile(filePaths[0], JSON.stringify(testData1));
      // file2.json doesn't exist
      await fs.writeFile(filePaths[2], "{ invalid json }");

      const consoleLogSpy = vi
        .spyOn(console, "log")
        .mockImplementation(() => {});

      const results = await readMultipleJSONFiles(filePaths);

      expect(results).toHaveLength(3);
      expect(results[0].ok).toBe(true);
      expect(results[1].ok).toBe(false);
      expect(results[1].code).toBe("not_found");
      expect(results[2].ok).toBe(false);
      expect(results[2].code).toBe("invalid_json");

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("Read 1/3 files successfully, 2 errors")
      );

      consoleLogSpy.mockRestore();
    });
  });

  describe("validateFilePath", () => {
    let jobTree;
    let testFilePath;

    beforeEach(async () => {
      jobTree = await createJobTree({ jobId: "test-validate" });
      testFilePath = path.join(jobTree.jobDir, "test-validate.json");
    });

    afterEach(async () => {
      if (jobTree) {
        await jobTree.cleanup();
      }
    });

    it("should validate existing file", async () => {
      const testData = { valid: true };
      await fs.writeFile(testFilePath, JSON.stringify(testData));

      const result = await validateFilePath(testFilePath);

      expect(result.ok).toBe(true);
      expect(result.path).toBe(testFilePath);
      expect(result.size).toBeGreaterThan(0);
      expect(result.modified).toBeInstanceOf(Date);
    });

    it("should return not_found for missing file", async () => {
      const result = await validateFilePath("/non/existent/file.json");

      expect(result.ok).toBe(false);
      expect(result.code).toBe("not_found");
    });

    it("should return fs_error for directory", async () => {
      const result = await validateFilePath(jobTree.jobDir);

      expect(result.ok).toBe(false);
      expect(result.code).toBe("fs_error");
      expect(result.message).toBe("Path is not a file");
    });

    it("should return fs_error for large file", async () => {
      const largeContent = "x".repeat(6 * 1024 * 1024); // 6MB
      await fs.writeFile(testFilePath, largeContent);

      const result = await validateFilePath(testFilePath);

      expect(result.ok).toBe(false);
      expect(result.code).toBe("fs_error");
      expect(result.message).toContain("File too large");
    });

    it("should handle permission errors", async () => {
      const mockStat = vi
        .spyOn(fs, "stat")
        .mockRejectedValue(new Error("Permission denied"));

      const result = await validateFilePath(testFilePath);

      expect(result.ok).toBe(false);
      expect(result.code).toBe("fs_error");
      expect(result.message).toContain("Validation error");

      mockStat.mockRestore();
    });
  });

  describe("getFileReadingStats", () => {
    it("should calculate correct statistics", () => {
      const filePaths = ["file1.json", "file2.json", "file3.json"];
      const results = [
        { ok: true },
        { ok: false, code: "not_found" },
        { ok: false, code: "invalid_json" },
      ];

      const stats = getFileReadingStats(filePaths, results);

      expect(stats.totalFiles).toBe(3);
      expect(stats.successCount).toBe(1);
      expect(stats.errorCount).toBe(2);
      expect(stats.successRate).toBeCloseTo(33.33);
      expect(stats.errorTypes).toEqual({
        not_found: 1,
        invalid_json: 1,
      });
    });

    it("should handle empty arrays", () => {
      const stats = getFileReadingStats([], []);

      expect(stats.totalFiles).toBe(0);
      expect(stats.successCount).toBe(0);
      expect(stats.errorCount).toBe(0);
      expect(stats.successRate).toBe(0);
      expect(stats.errorTypes).toEqual({});
    });

    it("should handle all successful reads", () => {
      const filePaths = ["file1.json", "file2.json"];
      const results = [{ ok: true }, { ok: true }];

      const stats = getFileReadingStats(filePaths, results);

      expect(stats.totalFiles).toBe(2);
      expect(stats.successCount).toBe(2);
      expect(stats.errorCount).toBe(0);
      expect(stats.successRate).toBe(100);
      expect(stats.errorTypes).toEqual({});
    });
  });
});
