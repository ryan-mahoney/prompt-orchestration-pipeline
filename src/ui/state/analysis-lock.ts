import type { AcquireResult, LockState } from "./types";

let currentLock: LockState | null = null;

function assertPipelineSlug(pipelineSlug: string): void {
  if (typeof pipelineSlug !== "string" || pipelineSlug.trim() === "") {
    throw new Error("analysis lock requires a non-empty pipeline slug");
  }
}

export function acquireLock(pipelineSlug: string): AcquireResult {
  assertPipelineSlug(pipelineSlug);
  if (currentLock) {
    return { acquired: false, heldBy: currentLock.pipelineSlug };
  }

  currentLock = { pipelineSlug, startedAt: new Date() };
  return { acquired: true };
}

export function releaseLock(pipelineSlug: string): void {
  assertPipelineSlug(pipelineSlug);
  if (!currentLock) {
    throw new Error("cannot release analysis lock when no lock is held");
  }
  if (currentLock.pipelineSlug !== pipelineSlug) {
    throw new Error(
      `cannot release analysis lock for "${pipelineSlug}" while held by "${currentLock.pipelineSlug}"`,
    );
  }

  currentLock = null;
}

export function getLockStatus(): LockState | null {
  return currentLock ? { ...currentLock } : null;
}
