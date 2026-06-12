import type { PipelineTaskEntry } from "./pipeline-runner";
import { isNonEmptyString, isPlainObject } from "./object-utils";

export interface ControlPatch {
  add: PipelineTaskEntry[];
  insertAfter?: string;
}

export interface ControlSkip {
  task: string;
  reason: string;
}

export interface ControlPause {
  message: string;
  artifacts?: string[];
}

export interface ControlDirectives {
  patch?: ControlPatch;
  skip?: ControlSkip[];
  pause?: ControlPause;
}

export const MAX_RUN_TASKS = 64;

export class ControlValidationError extends Error {
  override name = "ControlValidationError";

  constructor(violations: string[]) {
    super(violations.join("\n"));
  }
}

export function parseControlFile(text: string): ControlDirectives {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ControlValidationError([`invalid JSON: ${message}`]);
  }

  const violations: string[] = [];
  if (!isPlainObject(parsed)) {
    throw new ControlValidationError(["control file must be an object"]);
  }

  const allowedTopLevelKeys = new Set(["patch", "skip", "pause"]);
  for (const key of Object.keys(parsed)) {
    if (!allowedTopLevelKeys.has(key)) {
      violations.push(`unknown top-level key '${key}'`);
    }
  }

  if ("patch" in parsed) {
    validatePatchShape(parsed["patch"], violations);
  }

  if ("skip" in parsed) {
    validateSkipShape(parsed["skip"], violations);
  }

  if ("pause" in parsed) {
    validatePauseShape(parsed["pause"], violations);
  }

  if (violations.length > 0) {
    throw new ControlValidationError(violations);
  }

  return parsed as ControlDirectives;
}

export function validateControlDirectives(
  directives: ControlDirectives,
  ctx: {
    pipelineTasks: PipelineTaskEntry[];
    taskStates: Record<string, string>;
    registryKeys: string[];
    emittingTask: string;
  },
): void {
  const violations: string[] = [];
  const pipelineNames = ctx.pipelineTasks.map((task) => task.name);
  const pipelineNameSet = new Set(pipelineNames);
  const registryKeySet = new Set(ctx.registryKeys);
  const emitterIndex = pipelineNames.indexOf(ctx.emittingTask);

  if (emitterIndex === -1) {
    violations.push(`emitting task '${ctx.emittingTask}' does not exist in pipeline`);
  }

  const patch = directives.patch;
  if (patch) {
    const addedNames = new Set<string>();
    for (const entry of patch.add) {
      if (addedNames.has(entry.name)) {
        violations.push(`patch.add task name '${entry.name}' is duplicated within the batch`);
      } else {
        addedNames.add(entry.name);
      }

      if (pipelineNameSet.has(entry.name)) {
        violations.push(`patch.add task name '${entry.name}' already exists in the pipeline`);
      }

      const registryKey = entry.task ?? entry.name;
      if (!registryKeySet.has(registryKey)) {
        violations.push(`patch.add task '${entry.name}' references unregistered task key '${registryKey}'`);
      }
    }

    const insertAfter = patch.insertAfter ?? ctx.emittingTask;
    const insertAfterIndex = pipelineNames.indexOf(insertAfter);
    if (insertAfterIndex === -1) {
      violations.push(`patch.insertAfter '${insertAfter}' does not exist in the pipeline`);
    } else if (insertAfter !== ctx.emittingTask) {
      if (emitterIndex !== -1 && insertAfterIndex <= emitterIndex) {
        violations.push(`patch.insertAfter '${insertAfter}' must be the emitter or a later pending task`);
      }
      if (ctx.taskStates[insertAfter] !== "pending") {
        violations.push(`patch.insertAfter '${insertAfter}' must target a pending task`);
      }
    }

    const resultingTotal = ctx.pipelineTasks.length + patch.add.length;
    if (resultingTotal > MAX_RUN_TASKS) {
      violations.push(`patch would create ${resultingTotal} tasks, exceeding MAX_RUN_TASKS (${MAX_RUN_TASKS})`);
    }
  }

  for (const skip of directives.skip ?? []) {
    const skipIndex = pipelineNames.indexOf(skip.task);
    if (skipIndex === -1) {
      violations.push(`skip target '${skip.task}' does not exist in the pipeline`);
      continue;
    }

    if (emitterIndex !== -1 && skipIndex <= emitterIndex) {
      violations.push(`skip target '${skip.task}' must be after emitting task '${ctx.emittingTask}'`);
    }

    if (ctx.taskStates[skip.task] !== "pending") {
      violations.push(`skip target '${skip.task}' must be pending`);
    }
  }

  if (directives.pause && directives.pause.message.trim().length === 0) {
    violations.push("pause.message must be a non-empty string");
  }

  if (violations.length > 0) {
    throw new ControlValidationError(violations);
  }
}

function validatePatchShape(value: unknown, violations: string[]): void {
  if (!isPlainObject(value)) {
    violations.push("patch must be an object");
    return;
  }

  const allowedPatchKeys = new Set(["add", "insertAfter"]);
  for (const key of Object.keys(value)) {
    if (!allowedPatchKeys.has(key)) {
      violations.push(`patch has unknown key '${key}'`);
    }
  }

  if (!Array.isArray(value["add"])) {
    violations.push("patch.add must be an array");
  } else {
    value["add"].forEach((entry, index) => {
      validatePatchAddEntryShape(entry, `patch.add[${index}]`, violations);
    });
  }

  if ("insertAfter" in value && !isNonEmptyString(value["insertAfter"])) {
    violations.push("patch.insertAfter must be a non-empty string");
  }
}

function validatePatchAddEntryShape(value: unknown, path: string, violations: string[]): void {
  if (!isPlainObject(value)) {
    violations.push(`${path} must be an object`);
    return;
  }

  const allowedEntryKeys = new Set(["name", "task", "config", "gate"]);
  for (const key of Object.keys(value)) {
    if (!allowedEntryKeys.has(key)) {
      violations.push(`${path} has unknown key '${key}'`);
    }
  }

  if (!isNonEmptyString(value["name"])) {
    violations.push(`${path}.name must be a non-empty string`);
  }

  if ("task" in value && !isNonEmptyString(value["task"])) {
    violations.push(`${path}.task must be a non-empty string`);
  }

  if ("config" in value && !isPlainObject(value["config"])) {
    violations.push(`${path}.config must be a plain object`);
  }

  if ("gate" in value) {
    validateGateShape(value["gate"], `${path}.gate`, violations);
  }
}

function validateGateShape(value: unknown, path: string, violations: string[]): void {
  if (typeof value === "boolean") return;
  if (!isPlainObject(value)) {
    violations.push(`${path} must be a boolean or object`);
    return;
  }

  const allowedGateKeys = new Set(["message", "artifacts"]);
  for (const key of Object.keys(value)) {
    if (!allowedGateKeys.has(key)) {
      violations.push(`${path} has unknown key '${key}'`);
    }
  }

  if ("message" in value && typeof value["message"] !== "string") {
    violations.push(`${path}.message must be a string`);
  }

  if ("artifacts" in value) {
    validateArtifactsShape(value["artifacts"], `${path}.artifacts`, violations);
  }
}

function validateSkipShape(value: unknown, violations: string[]): void {
  if (!Array.isArray(value)) {
    violations.push("skip must be an array");
    return;
  }

  value.forEach((entry, index) => {
    const path = `skip[${index}]`;
    if (!isPlainObject(entry)) {
      violations.push(`${path} must be an object`);
      return;
    }

    const allowedSkipKeys = new Set(["task", "reason"]);
    for (const key of Object.keys(entry)) {
      if (!allowedSkipKeys.has(key)) {
        violations.push(`${path} has unknown key '${key}'`);
      }
    }

    if (!isNonEmptyString(entry["task"])) {
      violations.push(`${path}.task must be a non-empty string`);
    }
    if (!isNonEmptyString(entry["reason"])) {
      violations.push(`${path}.reason must be a non-empty string`);
    }
  });
}

function validatePauseShape(value: unknown, violations: string[]): void {
  if (!isPlainObject(value)) {
    violations.push("pause must be an object");
    return;
  }

  const allowedPauseKeys = new Set(["message", "artifacts"]);
  for (const key of Object.keys(value)) {
    if (!allowedPauseKeys.has(key)) {
      violations.push(`pause has unknown key '${key}'`);
    }
  }

  if (typeof value["message"] !== "string") {
    violations.push("pause.message must be a string");
  }

  if ("artifacts" in value) {
    validateArtifactsShape(value["artifacts"], "pause.artifacts", violations);
  }
}

function validateArtifactsShape(value: unknown, path: string, violations: string[]): void {
  if (!Array.isArray(value)) {
    violations.push(`${path} must be an array of strings`);
    return;
  }

  value.forEach((artifact, index) => {
    if (typeof artifact !== "string") {
      violations.push(`${path}[${index}] must be a string`);
    }
  });
}
