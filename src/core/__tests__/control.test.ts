import { describe, expect, test } from "bun:test";
import {
  ControlValidationError,
  MAX_RUN_TASKS,
  parseControlFile,
  validateControlDirectives,
} from "../control";
import type { ControlDirectives } from "../control";
import type { PipelineTaskEntry } from "../pipeline-runner";

const pipelineTasks: PipelineTaskEntry[] = [
  { name: "plan" },
  { name: "review" },
  { name: "finalize" },
];

const baseContext = {
  pipelineTasks,
  taskStates: {
    plan: "running",
    review: "pending",
    finalize: "pending",
  },
  registryKeys: ["plan", "review", "finalize", "worker", "shared-task"],
  emittingTask: "plan",
};

describe("parseControlFile", () => {
  test("parses a fixture exercising patch, skip, and pause directives", () => {
    const directives = parseControlFile(JSON.stringify({
      patch: {
        add: [
          {
            name: "implementation",
            task: "worker",
            config: { step: 1 },
            gate: { message: "Review output", artifacts: ["tasks/implementation/output.json"] },
          },
        ],
        insertAfter: "plan",
      },
      skip: [{ task: "finalize", reason: "superseded by implementation" }],
      pause: { message: "Approve implementation", artifacts: ["tasks/plan/proposal.md"] },
    }));

    expect(directives).toEqual({
      patch: {
        add: [
          {
            name: "implementation",
            task: "worker",
            config: { step: 1 },
            gate: { message: "Review output", artifacts: ["tasks/implementation/output.json"] },
          },
        ],
        insertAfter: "plan",
      },
      skip: [{ task: "finalize", reason: "superseded by implementation" }],
      pause: { message: "Approve implementation", artifacts: ["tasks/plan/proposal.md"] },
    });
  });

  test("rejects malformed JSON", () => {
    const message = expectControlValidationError(() => parseControlFile("{not json"));

    expect(message).toContain("invalid JSON");
  });

  test("rejects unknown top-level keys", () => {
    const message = expectControlValidationError(() => parseControlFile(JSON.stringify({
      patch: { add: [] },
      remove: ["review"],
    })));

    expect(message).toContain("unknown top-level key 'remove'");
  });
});

describe("validateControlDirectives", () => {
  test("accepts valid patch, skip, and pause directives", () => {
    const directives: ControlDirectives = {
      patch: {
        add: [{ name: "implementation", task: "worker" }],
      },
      skip: [{ task: "finalize", reason: "covered by generated steps" }],
      pause: { message: "Review before continuing" },
    };

    expect(() => validateControlDirectives(directives, baseContext)).not.toThrow();
  });

  test("rejects patch names already present in the pipeline", () => {
    const message = expectControlValidationError(() => validateControlDirectives({
      patch: { add: [{ name: "review" }] },
    }, baseContext));

    expect(message).toContain("already exists in the pipeline");
  });

  test("rejects patch names duplicated within the batch", () => {
    const message = expectControlValidationError(() => validateControlDirectives({
      patch: { add: [{ name: "implementation", task: "worker" }, { name: "implementation", task: "worker" }] },
    }, baseContext));

    expect(message).toContain("duplicated within the batch");
  });

  test("rejects unregistered added task keys", () => {
    const message = expectControlValidationError(() => validateControlDirectives({
      patch: { add: [{ name: "implementation", task: "missing-task" }] },
    }, baseContext));

    expect(message).toContain("unregistered task key 'missing-task'");
  });

  test("rejects insertAfter targets before the emitting task", () => {
    const message = expectControlValidationError(() => validateControlDirectives({
      patch: {
        add: [{ name: "implementation", task: "worker" }],
        insertAfter: "plan",
      },
    }, {
      ...baseContext,
      emittingTask: "review",
      taskStates: { ...baseContext.taskStates, plan: "done", review: "running" },
    }));

    expect(message).toContain("must be the emitter or a later pending task");
  });

  test("rejects insertAfter targets that are later but not pending", () => {
    const message = expectControlValidationError(() => validateControlDirectives({
      patch: {
        add: [{ name: "implementation", task: "worker" }],
        insertAfter: "review",
      },
    }, {
      ...baseContext,
      taskStates: { ...baseContext.taskStates, review: "running" },
    }));

    expect(message).toContain("must target a pending task");
  });

  test("rejects missing insertAfter targets", () => {
    const message = expectControlValidationError(() => validateControlDirectives({
      patch: {
        add: [{ name: "implementation", task: "worker" }],
        insertAfter: "missing",
      },
    }, baseContext));

    expect(message).toContain("does not exist in the pipeline");
  });

  test("rejects patches exceeding the run task limit", () => {
    const existingTasks = Array.from({ length: MAX_RUN_TASKS }, (_, index) => ({ name: `task-${index}` }));
    const message = expectControlValidationError(() => validateControlDirectives({
      patch: { add: [{ name: "implementation", task: "worker" }] },
    }, {
      ...baseContext,
      pipelineTasks: existingTasks,
      taskStates: Object.fromEntries(existingTasks.map((task, index) => [task.name, index === 0 ? "running" : "pending"])),
      emittingTask: "task-0",
    }));

    expect(message).toContain(`exceeding MAX_RUN_TASKS (${MAX_RUN_TASKS})`);
  });

  test("rejects skip targets that do not exist", () => {
    const message = expectControlValidationError(() => validateControlDirectives({
      skip: [{ task: "missing", reason: "not needed" }],
    }, baseContext));

    expect(message).toContain("skip target 'missing' does not exist");
  });

  test("rejects skip targets before or at the emitting task", () => {
    const message = expectControlValidationError(() => validateControlDirectives({
      skip: [{ task: "plan", reason: "not needed" }],
    }, baseContext));

    expect(message).toContain("must be after emitting task 'plan'");
  });

  test("rejects skip targets that are not pending", () => {
    const message = expectControlValidationError(() => validateControlDirectives({
      skip: [{ task: "review", reason: "not needed" }],
    }, {
      ...baseContext,
      taskStates: { ...baseContext.taskStates, review: "done" },
    }));

    expect(message).toContain("skip target 'review' must be pending");
  });

  test("rejects empty pause messages", () => {
    const message = expectControlValidationError(() => validateControlDirectives({
      pause: { message: "   " },
    }, baseContext));

    expect(message).toContain("pause.message must be a non-empty string");
  });

  test("reports all validation violations in one message", () => {
    const message = expectControlValidationError(() => validateControlDirectives({
      patch: {
        add: [
          { name: "review" },
          { name: "implementation", task: "missing-task" },
          { name: "implementation", task: "worker" },
        ],
        insertAfter: "missing",
      },
      skip: [{ task: "plan", reason: "not needed" }],
      pause: { message: "" },
    }, baseContext));

    expect(message).toContain("already exists in the pipeline");
    expect(message).toContain("unregistered task key 'missing-task'");
    expect(message).toContain("duplicated within the batch");
    expect(message).toContain("patch.insertAfter 'missing' does not exist");
    expect(message).toContain("skip target 'plan' must be after emitting task 'plan'");
    expect(message).toContain("skip target 'plan' must be pending");
    expect(message).toContain("pause.message must be a non-empty string");
  });
});

function expectControlValidationError(fn: () => void): string {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ControlValidationError);
    if (error instanceof Error) {
      expect(error.name).toBe("ControlValidationError");
      return error.message;
    }
  }

  throw new Error("expected ControlValidationError");
}
