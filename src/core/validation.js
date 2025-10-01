import Ajv from "ajv";
import { getConfig } from "./config.js";

const ajv = new Ajv({ allErrors: true });

// JSON schema for seed file structure - uses config for validation rules
function getSeedSchema() {
  const config = getConfig();
  return {
    type: "object",
    required: ["name", "data"],
    properties: {
      name: {
        type: "string",
        minLength: config.validation.seedNameMinLength,
        maxLength: config.validation.seedNameMaxLength,
        pattern: config.validation.seedNamePattern,
        description: "Job name (alphanumeric, hyphens, underscores only)",
      },
      data: {
        type: "object",
        description: "Job data payload",
      },
      metadata: {
        type: "object",
        description: "Optional metadata",
      },
    },
    additionalProperties: false,
  };
}

/**
 * Validates a seed file structure
 * @param {object} seed - The seed object to validate
 * @returns {object} Validation result with { valid: boolean, errors?: array }
 */
export function validateSeed(seed) {
  // Check if seed is an object
  if (!seed || typeof seed !== "object") {
    return {
      valid: false,
      errors: [
        {
          message: "Seed must be a valid JSON object",
          path: "",
        },
      ],
    };
  }

  // Compile schema with current config values
  const seedSchema = getSeedSchema();
  const validateSeedSchema = ajv.compile(seedSchema);
  const valid = validateSeedSchema(seed);

  if (!valid) {
    return {
      valid: false,
      errors: validateSeedSchema.errors.map((err) => ({
        message: err.message,
        path: err.instancePath || err.dataPath || "",
        params: err.params,
        keyword: err.keyword,
      })),
    };
  }

  return { valid: true };
}

/**
 * Formats validation errors into a human-readable message
 * @param {array} errors - Array of validation errors
 * @returns {string} Formatted error message
 */
export function formatValidationErrors(errors) {
  if (!errors || errors.length === 0) {
    return "Unknown validation error";
  }

  const messages = errors.map((err) => {
    const path = err.path ? `at '${err.path}'` : "";
    return `  - ${err.message} ${path}`.trim();
  });

  return `Seed validation failed:\n${messages.join("\n")}`;
}

/**
 * Validates seed and throws if invalid
 * @param {object} seed - The seed object to validate
 * @throws {Error} If validation fails
 */
export function validateSeedOrThrow(seed) {
  const result = validateSeed(seed);
  if (!result.valid) {
    throw new Error(formatValidationErrors(result.errors));
  }
}
