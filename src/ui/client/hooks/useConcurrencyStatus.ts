import { useCallback, useEffect, useRef, useState } from "react";

import { fetchConcurrencyStatus } from "../api";
import type {
  ApiError,
  JobConcurrencyApiStatus,
  UseConcurrencyStatusResult,
} from "../types";

const REFETCH_EVENTS = ["state:summary", "state:change"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toApiError(error: unknown): ApiError {
  if (isRecord(error) && typeof error["code"] === "string" && typeof error["message"] === "string") {
    return {
      code: error["code"] as ApiError["code"],
      message: error["message"],
      status: typeof error["status"] === "number" ? error["status"] : undefined,
    };
  }
  return {
    code: "unknown_error",
    message: error instanceof Error ? error.message : "Failed to load concurrency status",
  };
}

export function useConcurrencyStatus(): UseConcurrencyStatusResult {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<JobConcurrencyApiStatus | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const dataRef = useRef<JobConcurrencyApiStatus | null>(null);
  const mountedRef = useRef(true);
  const refetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback((showLoading = false) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    if (showLoading || dataRef.current === null) setLoading(true);

    void fetchConcurrencyStatus(controller.signal)
      .then((status) => {
        if (!mountedRef.current || abortRef.current !== controller) return;
        dataRef.current = status;
        setData(status);
        setError(null);
      })
      .catch((fetchError) => {
        if (fetchError instanceof DOMException && fetchError.name === "AbortError") return;
        if (!mountedRef.current || abortRef.current !== controller) return;
        setError(toApiError(fetchError));
      })
      .finally(() => {
        if (!mountedRef.current || abortRef.current !== controller) return;
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    load(true);

    const source = new EventSource("/api/events");
    const onMessage = () => {
      if (refetchTimerRef.current) return;
      refetchTimerRef.current = setTimeout(() => {
        refetchTimerRef.current = null;
        load(false);
      }, 0);
    };
    for (const eventName of REFETCH_EVENTS) {
      source.addEventListener(eventName, onMessage as EventListener);
    }
    source.onerror = () => {
      if (!mountedRef.current) return;
      setError({
        code: "network_error",
        message: "Live concurrency updates disconnected",
      });
    };

    return () => {
      mountedRef.current = false;
      if (refetchTimerRef.current) {
        clearTimeout(refetchTimerRef.current);
        refetchTimerRef.current = null;
      }
      abortRef.current?.abort();
      source.close();
    };
  }, [load]);

  const refetch = useCallback(() => {
    load(true);
  }, [load]);

  return { loading, data, error, refetch };
}
