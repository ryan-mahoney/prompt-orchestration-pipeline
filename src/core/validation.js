import Ajv from "ajv";

const ajv = new Ajv({ allErrors: true });

// JSON schema for seed file structure
const seedSchema = {
  type: "object",
  required: ["name", "data"],
  properties: {
    name: {
      type: "string",
      minLength: 1,
      maxLength: 100,
      pattern: "^[a-zA-Z0-9-_]+$",
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

const validateSeedSchema = ajv.compile(seedSchema);

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
