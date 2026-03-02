import type { TimeStoreListener, TimeStoreUnsubscribe } from "./types";

const FOREGROUND_MIN_INTERVAL_MS = 1_000;
const BACKGROUND_MIN_INTERVAL_MS = 60_000;
const epochOffsetMs = Date.now() - performance.now();

const listeners = new Set<TimeStoreListener>();
const cadenceHints = new Map<string, number>();

let timeoutId: ReturnType<typeof setTimeout> | null = null;
let intervalId: ReturnType<typeof setInterval> | null = null;
let cachedNow: number = Math.floor(epochOffsetMs + performance.now());

function getVisibilityState(): DocumentVisibilityState {
  if (typeof document === "undefined") return "visible";
  return document.visibilityState;
}

function notify(): void {
  cachedNow = Math.floor(epochOffsetMs + performance.now());
  for (const listener of listeners) listener();
}

function clearTimers(): void {
  if (timeoutId !== null) clearTimeout(timeoutId);
  if (intervalId !== null) clearInterval(intervalId);
  timeoutId = null;
  intervalId = null;
}

function getRequestedInterval(): number {
  const minHint = Math.min(...cadenceHints.values(), Number.POSITIVE_INFINITY);
  const foregroundInterval = Math.max(
    Number.isFinite(minHint) ? minHint : BACKGROUND_MIN_INTERVAL_MS,
    FOREGROUND_MIN_INTERVAL_MS,
  );

  if (getVisibilityState() === "hidden") {
    return Math.max(foregroundInterval, BACKGROUND_MIN_INTERVAL_MS);
  }

  return foregroundInterval;
}

function alignToNextMinute(now: number): number {
  return BACKGROUND_MIN_INTERVAL_MS - (now % BACKGROUND_MIN_INTERVAL_MS);
}

function startTimer(): void {
  clearTimers();
  if (listeners.size === 0) return;

  const intervalMs = getRequestedInterval();
  if (intervalMs >= BACKGROUND_MIN_INTERVAL_MS) {
    timeoutId = setTimeout(() => {
      notify();
      intervalId = setInterval(notify, intervalMs);
    }, alignToNextMinute(Date.now()));
    return;
  }

  intervalId = setInterval(notify, intervalMs);
}

function refreshTimer(): void {
  if (listeners.size === 0) {
    clearTimers();
    return;
  }
  startTimer();
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", refreshTimer);
}

export function subscribe(listener: TimeStoreListener): TimeStoreUnsubscribe {
  listeners.add(listener);
  if (listeners.size === 1) startTimer();

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) clearTimers();
  };
}

export function getSnapshot(): number {
  return cachedNow;
}

export function getServerSnapshot(): number {
  return cachedNow;
}

export function addCadenceHint(id: string, ms: number): void {
  cadenceHints.set(id, Math.max(ms, FOREGROUND_MIN_INTERVAL_MS));
  refreshTimer();
}

export function removeCadenceHint(id: string): void {
  cadenceHints.delete(id);
  refreshTimer();
}
