import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  validateAndParseJson,
  validateRequiredFields,
  validateNameFormat,
  checkDuplicateJob,
  validateSeed,
} from "../src/api/validators/seed.js";
import { validateSeed as validateSeedAjv } from "../src/core/validation.js";

describe("Seed Validation Utilities", () => {
  let tempDir;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "seed-test-"));
  });

  afterEach(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  describe("validateAndParseJson", () => {
    it("should parse valid JSON", () => {
      const jsonString = '{"name": "test", "data": {"key": "value"}}';
      const result = validateAndParseJson(jsonString);

      expect(result).toEqual({ name: "test", data: { key: "value" } });
    });

    it("should throw error with 'Invalid JSON' for invalid JSON", () => {
      const invalidJson = '{"name": "test", "data": {';

      expect(() => validateAndParseJson(invalidJson)).toThrow("Invalid JSON");
    });

    it("should throw error with 'Invalid JSON' for malformed JSON", () => {
      const malformedJson = '{"name": test}';

      expect(() => validateAndParseJson(malformedJson)).toThrow("Invalid JSON");
    });
  });

  describe("validateRequiredFields", () => {
    it("should validate object with required fields", () => {
      const validObject = {
        name: "test-job",
        data: { key: "value" },
        pipeline: "content",
      };
      const result = validateRequiredFields(validObject);

      expect(result).toEqual(validObject);
    });

    it("should throw error with 'required' for missing name field", () => {
      const invalidObject = { data: { key: "value" }, pipeline: "content" };

      expect(() => validateRequiredFields(invalidObject)).toThrow(
        "name field is required"
      );
    });

    it("should throw error with 'required' for empty name field", () => {
      const invalidObject = {
        name: "",
        data: { key: "value" },
        pipeline: "content",
      };

      expect(() => validateRequiredFields(invalidObject)).toThrow(
        "name field is required"
      );
    });

    it("should throw error with 'required' for missing data field", () => {
      const invalidObject = { name: "test-job", pipeline: "content" };

      expect(() => validateRequiredFields(invalidObject)).toThrow(
        "data field is required"
      );
    });

    it("should throw error with 'required' for non-object data field", () => {
      const invalidObject = {
        name: "test-job",
        data: "not-an-object",
        pipeline: "content",
      };

      expect(() => validateRequiredFields(invalidObject)).toThrow(
        "data field is required"
      );
    });

    it("should throw error with 'required' for missing pipeline field", () => {
      const invalidObject = { name: "test-job", data: { key: "value" } };

      expect(() => validateRequiredFields(invalidObject)).toThrow(
        "pipeline field is required"
      );
    });

    it("should throw error with 'required' for empty pipeline field", () => {
      const invalidObject = {
        name: "test-job",
        data: { key: "value" },
        pipeline: "",
      };

      expect(() => validateRequiredFields(invalidObject)).toThrow(
        "pipeline field is required"
      );
    });

    it("should throw error with 'required' for non-string pipeline field", () => {
      const invalidObject = {
        name: "test-job",
        data: { key: "value" },
        pipeline: 123,
      };

      expect(() => validateRequiredFields(invalidObject)).toThrow(
        "pipeline field is required"
      );
    });
  });

  describe("validateNameFormat", () => {
    it("should accept alphanumeric names", () => {
      expect(validateNameFormat("test123")).toBe("test123");
    });

    it("should accept names with hyphens", () => {
      expect(validateNameFormat("test-job")).toBe("test-job");
    });

    it("should accept names with underscores", () => {
      expect(validateNameFormat("test_job")).toBe("test_job");
    });

    it("should accept mixed valid characters", () => {
      expect(validateNameFormat("test-123_job")).toBe("test-123_job");
    });

    it("should accept names with spaces", () => {
      expect(validateNameFormat("test job")).toBe("test job");
    });

    it("should accept names with common punctuation", () => {
      expect(validateNameFormat("Market Analysis: Renewable Energy")).toBe(
        "Market Analysis: Renewable Energy"
      );
    });

    it("should trim whitespace", () => {
      expect(validateNameFormat("  trimmed job  ")).toBe("trimmed job");
    });

    it("should throw error for empty name", () => {
      expect(() => validateNameFormat("")).toThrow("name field is required");
    });

    it("should throw error for whitespace-only name", () => {
      expect(() => validateNameFormat("   ")).toThrow("name field is required");
    });

    it("should throw error for name exceeding 120 characters", () => {
      const longName = "a".repeat(121);
      expect(() => validateNameFormat(longName)).toThrow(
        "name must be 120 characters or less"
      );
    });

    it("should throw error for control characters", () => {
      expect(() => validateNameFormat("test\x00job")).toThrow(
        "name must contain only printable characters"
      );
    });
  });

  describe("checkDuplicateJob", () => {
    it("should return false when no duplicates exist", async () => {
      const jobName = "unique-job";
      const result = await checkDuplicateJob(tempDir, jobName);

      expect(result).toBe(false);
    });

    it("should return true when pending file exists", async () => {
      const jobName = "duplicate-job";
      const pendingPath = path.join(
        tempDir,
        "pipeline-data",
        "pending",
        `${jobName}-seed.json`
      );

      await fs.mkdir(path.dirname(pendingPath), { recursive: true });
      await fs.writeFile(pendingPath, JSON.stringify({ name: jobName }));

      const result = await checkDuplicateJob(tempDir, jobName);
      expect(result).toBe(true);
    });

    it("should return true when current file exists", async () => {
      const jobName = "duplicate-job";
      const currentPath = path.join(
        tempDir,
        "pipeline-data",
        "current",
        jobName,
        "seed.json"
      );

      await fs.mkdir(path.dirname(currentPath), { recursive: true });
      await fs.writeFile(currentPath, JSON.stringify({ name: jobName }));

      const result = await checkDuplicateJob(tempDir, jobName);
      expect(result).toBe(true);
    });

    it("should return true when complete file exists", async () => {
      const jobName = "duplicate-job";
      const completePath = path.join(
        tempDir,
        "pipeline-data",
        "complete",
        jobName,
        "seed.json"
      );

      await fs.mkdir(path.dirname(completePath), { recursive: true });
      await fs.writeFile(completePath, JSON.stringify({ name: jobName }));

      const result = await checkDuplicateJob(tempDir, jobName);
      expect(result).toBe(true);
    });
  });

  describe("validateSeed", () => {
    it("should validate complete valid seed", async () => {
      const validSeed = JSON.stringify({
        name: "test-job",
        data: { key: "value" },
        pipeline: "content",
      });

      const result = await validateSeed(validSeed, tempDir);

      expect(result).toEqual({
        name: "test-job",
        data: { key: "value" },
        pipeline: "content",
      });
    });

    it("should throw 'Invalid JSON' for invalid JSON", async () => {
      const invalidJson = '{"name": "test", "data": {';

      await expect(validateSeed(invalidJson, tempDir)).rejects.toThrow(
        "Invalid JSON"
      );
    });

    it("should throw 'required' for missing name field", async () => {
      const missingName = JSON.stringify({
        data: { key: "value" },
        pipeline: "content",
      });

      await expect(validateSeed(missingName, tempDir)).rejects.toThrow(
        "name field is required"
      );
    });

    it("should accept name with spaces in full validation", async () => {
      const validName = JSON.stringify({
        name: "Market Analysis about Renewable Energy Storage",
        data: { key: "value" },
        pipeline: "content",
      });

      const result = await validateSeed(validName, tempDir);
      expect(result.name).toBe(
        "Market Analysis about Renewable Energy Storage"
      );
    });

    it("should throw 'already exists' for duplicate job", async () => {
      const jobName = "duplicate-job";
      const validSeed = JSON.stringify({
        name: jobName,
        data: { key: "value" },
        pipeline: "content",
      });

      // Create a pending file to simulate duplicate
      const pendingPath = path.join(
        tempDir,
        "pipeline-data",
        "pending",
        `${jobName}-seed.json`
      );
      await fs.mkdir(path.dirname(pendingPath), { recursive: true });
      await fs.writeFile(pendingPath, JSON.stringify({ name: jobName }));

      await expect(validateSeed(validSeed, tempDir)).rejects.toThrow(
        "Job with this name already exists"
      );
    });

    it("should validate seed when no duplicates exist", async () => {
      const jobName = "unique-job";
      const validSeed = JSON.stringify({
        name: jobName,
        data: { key: "value" },
        pipeline: "content",
      });

      const result = await validateSeed(validSeed, tempDir);

      expect(result).toEqual({
        name: jobName,
        data: { key: "value" },
        pipeline: "content",
      });
    });

    it("should throw error for missing pipeline field", async () => {
      const missingPipeline = JSON.stringify({
        name: "test-job",
        data: { key: "value" },
      });

      await expect(validateSeed(missingPipeline, tempDir)).rejects.toThrow(
        "pipeline field is required"
      );
    });

    it("should throw error for unknown pipeline slug", async () => {
      const unknownPipeline = JSON.stringify({
        name: "test-job",
        data: { key: "value" },
        pipeline: "unknown-slug",
      });

      await expect(validateSeed(unknownPipeline, tempDir)).rejects.toThrow(
        "Pipeline unknown-slug not found in registry"
      );
    });
  });

  describe("Ajv Validation Tests", () => {
    it("should fail Ajv validation when pipeline is missing", () => {
      const seedWithoutPipeline = {
        name: "test-job",
        data: { key: "value" },
      };

      const result = validateSeedAjv(seedWithoutPipeline);

      expect(result.valid).toBe(false);
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            message: "must have required property 'pipeline'",
            keyword: "required",
          }),
        ])
      );
    });

    it("should pass Ajv validation with optional context key", () => {
      const seedWithContext = {
        name: "test-job",
        data: { key: "value" },
        pipeline: "content",
        context: {
          framing: "Test framing description",
          emphases: ["emphasis 1", "emphasis 2"],
          de_emphases: ["de-emphasis 1"],
          culturalMarkers: ["marker1", "marker2"],
          practitionerBias: "test_bias",
        },
      };

      const result = validateSeedAjv(seedWithContext);

      expect(result.valid).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    it("should pass Ajv validation without context key", () => {
      const seedWithoutContext = {
        name: "test-job",
        data: { key: "value" },
        pipeline: "content",
      };

      const result = validateSeedAjv(seedWithoutContext);

      expect(result.valid).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    it("should pass Ajv validation with partial context", () => {
      const seedWithPartialContext = {
        name: "test-job",
        data: { key: "value" },
        pipeline: "content",
        context: {
          framing: "Only framing provided",
        },
      };

      const result = validateSeedAjv(seedWithPartialContext);

      expect(result.valid).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    it("should pass Ajv validation with context containing additional properties", () => {
      const seedWithExtendedContext = {
        name: "test-job",
        data: { key: "value" },
        pipeline: "content",
        context: {
          framing: "Test framing",
          customField: "custom value",
        },
      };

      const result = validateSeedAjv(seedWithExtendedContext);

      expect(result.valid).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    it("should fail Ajv validation when pipeline is not in registry", () => {
      const seedWithUnknownPipeline = {
        name: "test-job",
        data: { key: "value" },
        pipeline: "does-not-exist",
      };

      const result = validateSeedAjv(seedWithUnknownPipeline);

      expect(result.valid).toBe(false);
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            message: "must be equal to one of the allowed values",
            keyword: "enum",
          }),
        ])
      );
    });

    it("should pass Ajv validation when pipeline is valid", () => {
      const seedWithValidPipeline = {
        name: "test-job",
        data: { key: "value" },
        pipeline: "content",
      };

      const result = validateSeedAjv(seedWithValidPipeline);

      expect(result.valid).toBe(true);
      expect(result.errors).toBeUndefined();
    });
  });

  describe("Imperative Validator Tests", () => {
    it("should throw 'pipeline field is required' when no pipeline is present", async () => {
      const seedWithoutPipeline = JSON.stringify({
        name: "test-job",
        data: { key: "value" },
      });

      await expect(validateSeed(seedWithoutPipeline, tempDir)).rejects.toThrow(
        "pipeline field is required"
      );
    });

    it("should throw when the slug is not in the registry", async () => {
      const seedWithUnknownPipeline = JSON.stringify({
        name: "test-job",
        data: { key: "value" },
        pipeline: "unknown-slug",
      });

      await expect(
        validateSeed(seedWithUnknownPipeline, tempDir)
      ).rejects.toThrow("Pipeline unknown-slug not found in registry");
    });
  });
});
