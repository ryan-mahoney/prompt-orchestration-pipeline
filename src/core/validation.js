import Ajv from "ajv";
import { getConfig } from "./config.js";

const ajv = new Ajv({ allErrors: true });

// JSON schema for seed file structure - uses config for validation rules
function getSeedSchema() {
  const config = getConfig();
  return {
    type: "object",
    required: ["name", "data", "pipeline"],
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
      pipeline: {
        type: "string",
        enum: Object.keys(config.pipelines),
        description: "Pipeline slug from registry",
      },
      metadata: {
        type: "object",
        description: "Optional metadata",
      },
      context: {
        type: "object",
        properties: {
          framing: { type: "string" },
          emphases: { type: "array", items: { type: "string" } },
          de_emphases: { type: "array", items: { type: "string" } },
          culturalMarkers: { type: "array", items: { type: "string" } },
          practitionerBias: {
            type: "string",
            enum: [
              "builders_operators",
              "strategic_thinkers",
              "balanced",
              "pastoral_bridge_builders",
            ],
          },
        },
        additionalProperties: true,
        description: "Optional context for pipeline execution",
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

/**
 * Validate pipeline config object shape (canonical)
 * Expected shape:
 * {
 *   name: string,
 *   tasks: string[],
 *   taskConfig?: { [taskName: string]: object }
 * }
 *
 * @param {object} pipeline - pipeline object to validate
 * @returns {{ valid: boolean, errors?: array }}
 */
export function validatePipeline(pipeline) {
  if (!pipeline || typeof pipeline !== "object") {
    return {
      valid: false,
      errors: [
        {
          message: "Pipeline must be a valid JSON object",
          path: "",
        },
      ],
    };
  }

  const pipelineSchema = {
    type: "object",
    required: ["name", "tasks"],
    properties: {
      name: { type: "string" },
      tasks: {
        type: "array",
        items: { type: "string" },
        minItems: 1,
      },
      taskConfig: {
        type: "object",
        additionalProperties: { type: "object" },
      },
    },
    additionalProperties: true,
  };

  const validatePipelineSchema = ajv.compile(pipelineSchema);
  const valid = validatePipelineSchema(pipeline);

  if (!valid) {
    return {
      valid: false,
      errors: validatePipelineSchema.errors.map((err) => ({
        message: err.message,
        path: err.instancePath || err.dataPath || "",
        params: err.params,
        keyword: err.keyword,
      })),
    };
  }

  // Additional check: ensure every task listed has either an entry in taskConfig or empty object is acceptable.
  if (Array.isArray(pipeline.tasks)) {
    for (const t of pipeline.tasks) {
      if (typeof t !== "string") {
        return {
          valid: false,
          errors: [
            {
              message: "Every task entry must be a string task name",
              path: "tasks",
            },
          ],
        };
      }
    }
  }

  return { valid: true };
}

/**
 * Formats pipeline validation errors into a human-readable message
 * @param {array} errors
 * @returns {string}
 */
export function formatPipelineValidationErrors(errors) {
  if (!errors || errors.length === 0) {
    return "Unknown pipeline validation error";
  }

  const messages = errors.map((err) => {
    const path = err.path ? `at '${err.path}'` : "";
    return `  - ${err.message} ${path}`.trim();
  });

  return `Pipeline validation failed:\n${messages.join("\n")}`;
}

/**
 * Validate pipeline object or throw an Error with friendly message.
 * Accepts either a pipeline object or the path string to the pipeline file,
 * in which case the caller should read and parse the file before calling.
 *
 * @param {object} pipeline - pipeline object to validate
 * @param {string} [pathHint] - optional path for error messages
 * @throws {Error} If validation fails
 */
export function validatePipelineOrThrow(pipeline, pathHint = "pipeline.json") {
  const result = validatePipeline(pipeline);
  if (!result.valid) {
    const header = `Invalid pipeline definition (${pathHint}):`;
    const body = formatPipelineValidationErrors(result.errors);
    throw new Error(`${header}\n${body}`);
  }
}
