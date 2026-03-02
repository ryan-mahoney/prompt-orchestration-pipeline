import Ajv from "ajv";
import addFormats from "ajv-formats";
import { getConfig } from "./config";

export interface ValidationError {
  message: string;
  path: string;
  params?: Record<string, unknown>;
  keyword?: string;
}

export type ValidationResult =
  | { valid: true }
  | { valid: false; errors: ValidationError[] };

const ajv = new Ajv({ allErrors: true });
addFormats(ajv);

export function validateSeed(seed: unknown): ValidationResult {
  if (typeof seed !== "object" || seed === null || Array.isArray(seed)) {
    return { valid: false, errors: [{ message: "Seed must be an object", path: "" }] };
  }

  const config = getConfig();
  const { seedNameMinLength, seedNameMaxLength, seedNamePattern } = config.validation;
  const pipelineSlugs = Object.keys(config.pipelines);

  const schema = {
    type: "object",
    required: ["name", "pipeline"],
    properties: {
      name: {
        type: "string",
        minLength: seedNameMinLength,
        maxLength: seedNameMaxLength,
        pattern: seedNamePattern,
      },
      pipeline: {
        type: "string",
        enum: pipelineSlugs.length > 0 ? pipelineSlugs : ["__no_pipelines_registered__"],
      },
    },
    additionalProperties: false,
  };

  const validate = ajv.compile(schema);
  const valid = validate(seed);

  if (valid) return { valid: true };

  const errors: ValidationError[] = (validate.errors ?? []).map((err) => ({
    message: err.message ?? "Validation error",
    path: err.instancePath,
    params: err.params as Record<string, unknown>,
    keyword: err.keyword,
  }));

  return { valid: false, errors };
}

export function formatValidationErrors(errors: ValidationError[]): string {
  return errors
    .map((e) => (e.path ? `${e.path}: ${e.message}` : e.message))
    .join("\n");
}

export function validateSeedOrThrow(seed: unknown): void {
  const result = validateSeed(seed);
  if (!result.valid) {
    throw new Error(formatValidationErrors(result.errors));
  }
}

export function validatePipeline(pipeline: unknown): ValidationResult {
  const pipelineSchema = {
    type: "object",
    required: ["name", "tasks"],
    properties: {
      name: { type: "string" },
      tasks: { type: "array", items: { type: "string" }, minItems: 1 },
    },
    additionalProperties: true,
  };

  const validatePipelineSchema = ajv.compile(pipelineSchema);
  const valid = validatePipelineSchema(pipeline);
  if (valid) return { valid: true };

  const errors: ValidationError[] = (validatePipelineSchema.errors ?? []).map((err) => ({
    message: err.message ?? "Validation error",
    path: err.instancePath,
    params: err.params as Record<string, unknown>,
    keyword: err.keyword,
  }));

  return { valid: false, errors };
}

export function formatPipelineValidationErrors(errors: ValidationError[]): string {
  return errors
    .map((e) => (e.path ? `${e.path}: ${e.message}` : e.message))
    .join("\n");
}

export function validatePipelineOrThrow(pipeline: unknown, pathHint = "pipeline.json"): void {
  const result = validatePipeline(pipeline);
  if (!result.valid) {
    throw new Error(`${pathHint}: ${formatPipelineValidationErrors(result.errors)}`);
  }
}
