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
  const mountedRef = useRef(true);

  const load = useCallback(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);

    void fetchConcurrencyStatus(controller.signal)
      .then((status) => {
        if (!mountedRef.current) return;
        setData(status);
        setError(null);
      })
      .catch((fetchError) => {
        if (fetchError instanceof DOMException && fetchError.name === "AbortError") return;
        if (!mountedRef.current) return;
        setError(toApiError(fetchError));
      })
      .finally(() => {
        if (!mountedRef.current) return;
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    load();

    const source = new EventSource("/api/events");
    const onMessage = () => load();
    for (const eventName of REFETCH_EVENTS) {
      source.addEventListener(eventName, onMessage as EventListener);
    }

    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
      source.close();
    };
  }, [load]);

  const refetch = useCallback(() => {
    load();
  }, [load]);

  return { loading, data, error, refetch };
}
