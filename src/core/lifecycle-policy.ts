type LifecycleOp = "start" | "restart";

interface TransitionInput {
  op: LifecycleOp;
  taskState: string;
  dependenciesReady: boolean;
}

interface TransitionAllowed {
  ok: true;
}

interface TransitionBlocked {
  ok: false;
  code: "unsupported_lifecycle";
  reason: "dependencies" | "policy";
}

type TransitionDecision = TransitionAllowed | TransitionBlocked;

const ALLOWED: Readonly<TransitionAllowed> = Object.freeze({ ok: true as const });
const BLOCKED_DEPS: Readonly<TransitionBlocked> = Object.freeze({
  ok: false as const,
  code: "unsupported_lifecycle" as const,
  reason: "dependencies" as const,
});
const BLOCKED_POLICY: Readonly<TransitionBlocked> = Object.freeze({
  ok: false as const,
  code: "unsupported_lifecycle" as const,
  reason: "policy" as const,
});

export function decideTransition(input: TransitionInput): Readonly<TransitionDecision> {
  const { op, taskState, dependenciesReady } = input;

  if (op !== "start" && op !== "restart") {
    throw new Error(`Invalid op: expected "start" or "restart", got ${JSON.stringify(op)}`);
  }
  if (typeof taskState !== "string") {
    throw new Error(`Invalid taskState: expected string, got ${typeof taskState}`);
  }
  if (typeof dependenciesReady !== "boolean") {
    throw new Error(`Invalid dependenciesReady: expected boolean, got ${typeof dependenciesReady}`);
  }

  if (op === "start") {
    return dependenciesReady ? ALLOWED : BLOCKED_DEPS;
  }

  // op === "restart": only allowed from "done" state, ignores dependenciesReady
  return taskState === "done" ? ALLOWED : BLOCKED_POLICY;
}
