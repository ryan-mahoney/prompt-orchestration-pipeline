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
  const errors: ValidationError[] = [];

  if (!isPlainObject(pipeline)) {
    return { valid: false, errors: [{ message: "must be object", path: "" }] };
  }

  if (typeof pipeline["name"] !== "string") {
    errors.push({
      message: "must have required string property 'name'",
      path: "/name",
      keyword: "required",
    });
  }

  if (!Array.isArray(pipeline["tasks"])) {
    errors.push({
      message: "must have required array property 'tasks'",
      path: "/tasks",
      keyword: "required",
    });
    return { valid: false, errors };
  }

  const tasks = pipeline["tasks"];
  if (tasks.length === 0) {
    errors.push({
      message: "must NOT have fewer than 1 items",
      path: "/tasks",
      keyword: "minItems",
    });
  }

  const seenTaskNames = new Set<string>();
  tasks.forEach((task, index) => {
    const path = `/tasks/${index}`;
    const taskName = getPipelineTaskEntryName(task);

    if (taskName === null) {
      errors.push({
        message: "must be a non-empty string or task entry object",
        path,
        keyword: "type",
      });
      return;
    }

    if (seenTaskNames.has(taskName)) {
      errors.push({
        message: `duplicate task name '${taskName}'`,
        path,
        params: { duplicateTaskName: taskName },
        keyword: "uniqueItems",
      });
    } else {
      seenTaskNames.add(taskName);
    }

    if (typeof task === "string") return;

    validatePipelineTaskEntry(task, path, errors);
  });

  if (errors.length === 0) return { valid: true };

  return { valid: false, errors };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function getPipelineTaskEntryName(task: unknown): string | null {
  if (isNonEmptyString(task)) return task;
  if (isPlainObject(task) && isNonEmptyString(task["name"])) return task["name"];
  return null;
}

function validatePipelineTaskEntry(
  task: Record<string, unknown>,
  path: string,
  errors: ValidationError[],
): void {
  const allowedKeys = new Set(["name", "task", "config", "gate"]);
  for (const key of Object.keys(task)) {
    if (!allowedKeys.has(key)) {
      errors.push({
        message: "must NOT have additional properties",
        path: `${path}/${key}`,
        params: { additionalProperty: key },
        keyword: "additionalProperties",
      });
    }
  }

  if (!isNonEmptyString(task["name"])) {
    errors.push({
      message: "name must be a non-empty string",
      path: `${path}/name`,
      keyword: "type",
    });
  }

  if ("task" in task && !isNonEmptyString(task["task"])) {
    errors.push({
      message: "task must be a non-empty string",
      path: `${path}/task`,
      keyword: "type",
    });
  }

  if ("config" in task && !isPlainObject(task["config"])) {
    errors.push({
      message: "config must be a plain object",
      path: `${path}/config`,
      keyword: "type",
    });
  }

  if ("gate" in task) {
    validatePipelineTaskGate(task["gate"], `${path}/gate`, errors);
  }
}

function validatePipelineTaskGate(
  gate: unknown,
  path: string,
  errors: ValidationError[],
): void {
  if (typeof gate === "boolean") return;
  if (!isPlainObject(gate)) {
    errors.push({
      message: "gate must be a boolean or object",
      path,
      keyword: "type",
    });
    return;
  }

  const allowedKeys = new Set(["message", "artifacts"]);
  for (const key of Object.keys(gate)) {
    if (!allowedKeys.has(key)) {
      errors.push({
        message: "must NOT have additional properties",
        path: `${path}/${key}`,
        params: { additionalProperty: key },
        keyword: "additionalProperties",
      });
    }
  }

  if ("message" in gate && typeof gate["message"] !== "string") {
    errors.push({
      message: "message must be a string",
      path: `${path}/message`,
      keyword: "type",
    });
  }

  if ("artifacts" in gate) {
    if (!Array.isArray(gate["artifacts"])) {
      errors.push({
        message: "artifacts must be an array of strings",
        path: `${path}/artifacts`,
        keyword: "type",
      });
      return;
    }

    gate["artifacts"].forEach((artifact, index) => {
      if (typeof artifact !== "string") {
        errors.push({
          message: "artifact must be a string",
          path: `${path}/artifacts/${index}`,
          keyword: "type",
        });
      }
    });
  }
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
