/**
 * Seed validation utilities
 * @module api/validators/seed
 */

import { promises as fs } from "fs";
import path from "path";
import { getPipelineConfig } from "../../core/config.js";

/**
 * Validate JSON string and parse it
 * @param {string} jsonString - JSON string to validate
 * @returns {Object} Parsed JSON object
 * @throws {Error} With message containing "Invalid JSON" on parse failure
 */
function validateAndParseJson(jsonString) {
  try {
    return JSON.parse(jsonString);
  } catch (error) {
    throw new Error("Invalid JSON");
  }
}

/**
 * Validate required fields in seed object
 * @param {Object} seedObject - Seed object to validate
 * @returns {Object} Validated seed object
 * @throws {Error} With message containing "required" if fields are missing
 */
function validateRequiredFields(seedObject) {
  if (
    !seedObject.name ||
    typeof seedObject.name !== "string" ||
    seedObject.name.trim() === ""
  ) {
    throw new Error("name field is required");
  }

  if (!seedObject.data || typeof seedObject.data !== "object") {
    throw new Error("data field is required");
  }

  if (
    !seedObject.pipeline ||
    typeof seedObject.pipeline !== "string" ||
    seedObject.pipeline.trim() === ""
  ) {
    throw new Error("pipeline field is required");
  }

  return seedObject;
}

/**
 * Validate name format (alphanumeric + -/_ allowed)
 * @param {string} name - Name to validate
 * @returns {string} Validated name
 * @throws {Error} With message containing "required" if format is invalid
 */
function validateNameFormat(name) {
  const nameRegex = /^[a-zA-Z0-9_-]+$/;
  if (!nameRegex.test(name)) {
    throw new Error(
      "name must contain only alphanumeric characters, hyphens, and underscores"
    );
  }
  return name;
}

/**
 * Check if a job with the given name already exists
 * @param {string} baseDir - Base data directory
 * @param {string} jobName - Job name to check
 * @returns {Promise<boolean>} True if duplicate exists
 */
async function checkDuplicateJob(baseDir, jobName) {
  const { getPendingSeedPath, getCurrentSeedPath, getCompleteSeedPath } =
    await import("../../config/paths.js");

  const paths = [
    getPendingSeedPath(baseDir, jobName),
    getCurrentSeedPath(baseDir, jobName),
    getCompleteSeedPath(baseDir, jobName),
  ];

  for (const filePath of paths) {
    try {
      await fs.access(filePath);
      return true; // File exists, duplicate found
    } catch (error) {
      // File doesn't exist, continue checking
    }
  }

  return false; // No duplicates found
}

/**
 * Comprehensive seed validation
 * @param {string} jsonString - JSON string to validate
 * @param {string} baseDir - Base data directory for duplicate checking
 * @returns {Promise<Object>} Validated seed object
 * @throws {Error} With appropriate error message
 */
async function validateSeed(jsonString, baseDir) {
  // Step 1: Validate and parse JSON
  const seedObject = validateAndParseJson(jsonString);

  // Step 2: Validate required fields
  const validatedObject = validateRequiredFields(seedObject);

  // Step 3: Validate name format
  validateNameFormat(validatedObject.name);

  // Step 4: Validate pipeline slug against registry
  getPipelineConfig(validatedObject.pipeline);

  // Step 5: Check for duplicates
  const isDuplicate = await checkDuplicateJob(baseDir, validatedObject.name);
  if (isDuplicate) {
    throw new Error("Job with this name already exists");
  }

  return validatedObject;
}

export {
  validateAndParseJson,
  validateRequiredFields,
  validateNameFormat,
  checkDuplicateJob,
  validateSeed,
};
