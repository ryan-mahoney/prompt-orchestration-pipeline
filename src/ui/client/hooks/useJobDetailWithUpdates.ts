import { useCallback, useEffect, useRef, useState, useTransition } from "react";

import { adaptJobDetail } from "../adapters/job-adapter";
import type {
  ConnectionStatus,
  NormalizedJobDetail,
  NormalizedTask,
  SseJobEvent,
  UseJobDetailWithUpdatesResult,
} from "../types";

export const REFRESH_DEBOUNCE_MS = 200;
export const POLL_INTERVAL_MS = 3_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function extractJobDetail(payload: unknown): Record<string, unknown> | null {
  if (isRecord(payload) && isRecord(payload["data"])) return payload["data"];
  if (isRecord(payload)) return payload;
  return null;
}

function getPipelineTaskCount(detail: NormalizedJobDetail): number | null {
  const config = detail.pipelineConfig;
  if (config && Array.isArray(config["tasks"])) return config["tasks"].length;
  return null;
}

function getPipelineTaskNames(detail: NormalizedJobDetail): string[] {
  const config = detail.pipelineConfig;
  if (!config || !Array.isArray(config["tasks"])) return Object.keys(detail.tasks);

  const names = config["tasks"].flatMap((task) => {
    if (typeof task === "string") return [task];
    if (isRecord(task) && typeof task["name"] === "string") return [task["name"]];
    return [];
  });
  return names.length > 0 ? names : Object.keys(detail.tasks);
}

function sameTaskSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((taskName) => rightSet.has(taskName));
}

export function shouldRefetchDetailForTaskSet(detail: NormalizedJobDetail, event: SseJobEvent): boolean {
  if (event.type === "task:updated") {
    const taskName = typeof event.data["taskName"] === "string" ? event.data["taskName"] : null;
    return taskName !== null && detail.tasks[taskName] === undefined;
  }

  if (event.type !== "job:updated") return false;
  const rawTasks = event.data["tasks"];
  if (!isRecord(rawTasks)) return false;

  const incomingTaskNames = Object.keys(rawTasks);
  if (incomingTaskNames.length === 0) return false;
  return !sameTaskSet(getPipelineTaskNames(detail), incomingTaskNames);
}

function recomputeProgress(detail: NormalizedJobDetail): NormalizedJobDetail {
  const tasks = Object.values(detail.tasks);
  const doneCount = tasks.filter((task) => task.state === "done").length;
  const completedCount = tasks.filter((task) => task.state === "done" || task.state === "skipped").length;
  const taskCount = getPipelineTaskCount(detail) ?? tasks.length;
  return {
    ...detail,
    doneCount,
    completedCount,
    taskCount,
    progress: taskCount === 0 ? 0 : Math.min(100, Math.floor((completedCount / taskCount) * 100)),
    updatedAt: new Date().toISOString(),
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function matchesJobTasksStatusPath(path: string, jobId: string): boolean {
  const pattern = new RegExp(`(^|/)pipeline-data/(current|complete|pending|rejected)/${escapeRegExp(jobId)}/`);
  return pattern.test(path);
}

export function applyDetailEvent(
  detail: NormalizedJobDetail,
  event: SseJobEvent,
): NormalizedJobDetail {
  const eventJobId = typeof event.data["jobId"] === "string" ? event.data["jobId"] : null;
  if (eventJobId !== detail.jobId) return detail;

  if (event.type === "job:updated") {
    return adaptJobDetail({ ...detail, ...event.data });
  }

  if (event.type === "task:updated") {
    const taskName = typeof event.data["taskName"] === "string" ? event.data["taskName"] : null;
    if (taskName === null) return detail;
    const currentTask = detail.tasks[taskName];
    if (!currentTask) return detail;

    const nextTask: NormalizedTask = {
      ...currentTask,
      ...(isRecord(event.data["task"]) ? adaptJobDetail({
        ...detail,
        tasks: {
          [taskName]: event.data["task"],
        },
      }).tasks[taskName] ?? currentTask : currentTask),
    };

    return recomputeProgress({
      ...detail,
      tasks: {
        ...detail.tasks,
        [taskName]: nextTask,
      },
    });
  }

  return detail;
}

async function fetchJobDetail(jobId: string, signal: AbortSignal): Promise<NormalizedJobDetail> {
  const response = await fetch(`/api/jobs/${jobId}`, { signal });
  const payload = extractJobDetail(await response.json());
  return adaptJobDetail(payload ?? {});
}

export function useJobDetailWithUpdates(jobId: string): UseJobDetailWithUpdatesResult {
  const [data, setData] = useState<NormalizedJobDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("disconnected");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isHydrated, setIsHydrated] = useState(false);
  const [isTransitioning, startTransition] = useTransition();
  const mountedRef = useRef(true);
  const dataRef = useRef<NormalizedJobDetail | null>(null);
  const hydratedRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const queueRef = useRef<SseJobEvent[]>([]);
  const refetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refetchingRef = useRef(false);

  const load = useCallback(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const alreadyHydrated = hydratedRef.current;
    setLoading(!alreadyHydrated);
    setIsRefreshing(alreadyHydrated);
    refetchingRef.current = true;

    void fetchJobDetail(jobId, controller.signal)
      .then((detail) => {
        if (!mountedRef.current) return;
        const replayed = queueRef.current.reduce(applyDetailEvent, detail);
        queueRef.current = [];
        dataRef.current = replayed;
        hydratedRef.current = true;
        setData(replayed);
        setError(null);
        setIsHydrated(true);
      })
      .catch((fetchError) => {
        if (fetchError instanceof DOMException && fetchError.name === "AbortError") return;
        if (!mountedRef.current) return;
        setError(fetchError instanceof Error ? fetchError.message : "Failed to load job");
      })
      .finally(() => {
        if (!mountedRef.current) return;
        setLoading(false);
        setIsRefreshing(false);
        refetchingRef.current = false;
      });
  }, [jobId]);

  useEffect(() => {
    mountedRef.current = true;
    hydratedRef.current = false;
    dataRef.current = null;
    setData(null);
    setError(null);
    setLoading(true);
    setIsRefreshing(false);
    setIsHydrated(false);
    setConnectionStatus("disconnected");
    queueRef.current = [];
    load();

    const source = new EventSource(`/api/events?jobId=${encodeURIComponent(jobId)}`);
    source.onopen = () => setConnectionStatus("connected");
    source.onerror = () => setConnectionStatus(source.readyState === 2 ? "disconnected" : "error");

    const scheduleRefetch = () => {
      if (refetchTimerRef.current !== null) clearTimeout(refetchTimerRef.current);
      refetchTimerRef.current = setTimeout(load, REFRESH_DEBOUNCE_MS);
    };

    const onMessage = (event: MessageEvent<string>) => {
      let payload: SseJobEvent;
      try {
        payload = {
          type: event.type as SseJobEvent["type"],
          data: JSON.parse(event.data) as Record<string, unknown>,
        };
      } catch (parseError) {
        console.warn("Failed to parse job detail SSE payload", parseError);
        return;
      }

      if (payload.type === "state:change") {
        const path = typeof payload.data["path"] === "string" ? payload.data["path"] : "";
        if (matchesJobTasksStatusPath(path, jobId)) {
          scheduleRefetch();
        }
        return;
      }

      if (!hydratedRef.current || refetchingRef.current || dataRef.current === null) {
        queueRef.current.push(payload);
        return;
      }

      if (shouldRefetchDetailForTaskSet(dataRef.current, payload)) {
        scheduleRefetch();
        return;
      }

      startTransition(() => {
        setData((current) => {
          if (current === null) return current;
          const next = applyDetailEvent(current, payload);
          dataRef.current = next;
          return next;
        });
      });
    };

    source.addEventListener("job:updated", onMessage as EventListener);
    source.addEventListener("task:updated", onMessage as EventListener);
    source.addEventListener("state:change", onMessage as EventListener);

    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
      source.close();
      if (refetchTimerRef.current !== null) clearTimeout(refetchTimerRef.current);
    };
  }, [jobId, load]);

  // Poll while the job is running to catch file updates that SSE may miss
  useEffect(() => {
    const status = data?.status;
    if (status !== "running") return undefined;

    const interval = setInterval(() => {
      if (!refetchingRef.current) load();
    }, POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [data?.status, load]);

  return {
    data,
    loading,
    error,
    connectionStatus,
    isRefreshing,
    isTransitioning,
    isHydrated,
  };
}
