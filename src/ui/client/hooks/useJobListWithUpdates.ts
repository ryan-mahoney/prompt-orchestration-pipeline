import { useEffect, useRef, useState } from "react";

import { adaptJobSummary } from "../adapters/job-adapter";
import { useJobList } from "./useJobList";
import type {
  ConnectionStatus,
  NormalizedJobSummary,
  SseJobEvent,
  UseJobListWithUpdatesResult,
} from "../types";

const REFETCH_EVENTS = new Set(["seed:uploaded", "state:change", "state:summary"]);
const RECONNECT_DELAY_MS = 2_000;
const REFETCH_DEBOUNCE_MS = 300;

function sortNormalizedJobs(jobs: NormalizedJobSummary[]): NormalizedJobSummary[] {
  const priority: Record<string, number> = {
    running: 4,
    failed: 3,
    pending: 2,
    complete: 1,
  };

  return jobs.slice().sort((left, right) => {
    const statusOrder = (priority[right.status] ?? 0) - (priority[left.status] ?? 0);
    if (statusOrder !== 0) return statusOrder;
    const leftCreated = left.createdAt ?? "";
    const rightCreated = right.createdAt ?? "";
    const createdOrder = leftCreated.localeCompare(rightCreated);
    if (createdOrder !== 0) return createdOrder;
    return left.jobId.localeCompare(right.jobId);
  });
}

function jobsEqual(left: NormalizedJobSummary[], right: NormalizedJobSummary[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function mergeJob(current: NormalizedJobSummary, incoming: NormalizedJobSummary): NormalizedJobSummary {
  return {
    ...current,
    ...incoming,
    id: incoming.id || current.id,
    jobId: incoming.jobId || current.jobId,
    name: incoming.name || current.name,
    createdAt: incoming.createdAt ?? current.createdAt,
    updatedAt: incoming.updatedAt ?? current.updatedAt,
    pipeline: incoming.pipeline ?? current.pipeline,
    pipelineLabel: incoming.pipelineLabel ?? current.pipelineLabel,
    current: incoming.current ?? current.current,
    currentStage: incoming.currentStage ?? current.currentStage,
  };
}

export function applyJobEvent(
  jobs: NormalizedJobSummary[],
  event: SseJobEvent,
): NormalizedJobSummary[] {
  const incoming = adaptJobSummary(event.data);
  const key = incoming.jobId;

  if (event.type === "job:removed") {
    const next = jobs.filter((job) => job.jobId !== key);
    return jobsEqual(next, jobs) ? jobs : sortNormalizedJobs(next);
  }

  if (event.type === "job:created" || event.type === "job:updated") {
    const existingIndex = jobs.findIndex((job) => job.jobId === key);
    const next = existingIndex === -1
      ? [...jobs, incoming]
      : jobs.map((job, index) => index === existingIndex ? mergeJob(job, incoming) : job);
    const sorted = sortNormalizedJobs(next);
    return jobsEqual(sorted, jobs) ? jobs : sorted;
  }

  return jobs;
}

export function shouldRefetchForListEvent(type: string): boolean {
  return REFETCH_EVENTS.has(type);
}

export function useJobListWithUpdates(): UseJobListWithUpdatesResult {
  const base = useJobList();
  const [data, setData] = useState<NormalizedJobSummary[] | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("disconnected");
  const hydratedRef = useRef(false);
  const dataRef = useRef<NormalizedJobSummary[] | null>(null);
  const queueRef = useRef<SseJobEvent[]>([]);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refetchingRef = useRef(false);
  const refetchRef = useRef(base.refetch);

  refetchRef.current = base.refetch;

  useEffect(() => {
    if (base.data === null) return;
    hydratedRef.current = true;
    const snapshot = sortNormalizedJobs(base.data);
    const replayed = queueRef.current.reduce(applyJobEvent, snapshot);
    queueRef.current = [];
    dataRef.current = replayed;
    setData(replayed);
    refetchingRef.current = false;
  }, [base.data]);

  useEffect(() => {
    let disposed = false;

    const scheduleRefetch = () => {
      if (refetchTimerRef.current !== null) clearTimeout(refetchTimerRef.current);
      refetchTimerRef.current = setTimeout(() => {
        if (disposed) return;
        refetchingRef.current = true;
        refetchRef.current();
      }, REFETCH_DEBOUNCE_MS);
    };

    const connect = () => {
      if (disposed) return;
      const source = new EventSource("/api/events");
      eventSourceRef.current = source;
      source.onopen = () => {
        if (reconnectTimerRef.current !== null) {
          clearTimeout(reconnectTimerRef.current);
          reconnectTimerRef.current = null;
        }
        setConnectionStatus("connected");
      };
      source.onerror = () => {
        if (disposed) return;
        setConnectionStatus(source.readyState === 2 ? "disconnected" : "error");
        if (source.readyState === 2) {
          source.close();
          reconnectTimerRef.current = setTimeout(connect, RECONNECT_DELAY_MS);
        }
      };

      const onMessage = (event: MessageEvent<string>) => {
        let payload: SseJobEvent | null = null;
        try {
          payload = { type: event.type as SseJobEvent["type"], data: JSON.parse(event.data) as Record<string, unknown> };
        } catch (error) {
          console.warn("Failed to parse job list SSE payload", error);
          return;
        }

        if (shouldRefetchForListEvent(payload.type)) {
          scheduleRefetch();
          return;
        }

        if (!hydratedRef.current || refetchingRef.current) {
          queueRef.current.push(payload);
          return;
        }

        setData((current) => {
          if (current === null) return current;
          const next = applyJobEvent(current, payload);
          dataRef.current = next;
          return next;
        });
      };

      source.addEventListener("job:created", onMessage as EventListener);
      source.addEventListener("job:updated", onMessage as EventListener);
      source.addEventListener("job:removed", onMessage as EventListener);
      source.addEventListener("seed:uploaded", onMessage as EventListener);
      source.addEventListener("state:change", onMessage as EventListener);
      source.addEventListener("state:summary", onMessage as EventListener);
    };

    connect();

    return () => {
      disposed = true;
      eventSourceRef.current?.close();
      if (reconnectTimerRef.current !== null) clearTimeout(reconnectTimerRef.current);
      if (refetchTimerRef.current !== null) clearTimeout(refetchTimerRef.current);
    };
  }, [base.refetch]);

  return {
    ...base,
    data,
    connectionStatus,
  };
}
