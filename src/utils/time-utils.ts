import type { DagItem, TaskStateObject } from "../ui/components/types";

function toMs(value?: string | number | null): number | null {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

export function taskToTimerProps(task: Pick<TaskStateObject | DagItem, "startedAt" | "endedAt">): {
  startMs: number | null;
  endMs: number | null;
} {
  return {
    startMs: toMs(task.startedAt),
    endMs: toMs(task.endedAt),
  };
}
