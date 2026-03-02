import type { ChangeEntry, ChangeTrackerState, ChangeType } from "./types";

const MAX_RECENT_CHANGES = 10;

function nowIso(): string {
  return new Date().toISOString();
}

let state: ChangeTrackerState = {
  updatedAt: nowIso(),
  changeCount: 0,
  recentChanges: [],
  watchedPaths: [],
};

function cloneChange(change: ChangeEntry): ChangeEntry {
  return { ...change };
}

function cloneState(current: ChangeTrackerState): ChangeTrackerState {
  return {
    updatedAt: current.updatedAt,
    changeCount: current.changeCount,
    recentChanges: current.recentChanges.map(cloneChange),
    watchedPaths: [...current.watchedPaths],
  };
}

export function getState(): ChangeTrackerState {
  return cloneState(state);
}

export function recordChange(path: string, type: ChangeType): ChangeEntry {
  const change: ChangeEntry = { path, type, timestamp: nowIso() };
  state = {
    ...state,
    updatedAt: change.timestamp,
    changeCount: state.changeCount + 1,
    recentChanges: [change, ...state.recentChanges].slice(0, MAX_RECENT_CHANGES),
  };
  return cloneChange(change);
}

export function reset(): void {
  state = {
    updatedAt: nowIso(),
    changeCount: 0,
    recentChanges: [],
    watchedPaths: [...state.watchedPaths],
  };
}

export function setWatchedPaths(paths: string[]): void {
  state = {
    ...state,
    updatedAt: nowIso(),
    watchedPaths: [...paths],
  };
}
