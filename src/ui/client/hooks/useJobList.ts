import { useCallback, useEffect, useRef, useState } from "react";

import { adaptJobSummary } from "../adapters/job-adapter";
import type { ApiError, NormalizedJobSummary, UseJobListResult } from "../types";

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
    message: error instanceof Error ? error.message : "Failed to load jobs",
  };
}

export function extractJobList(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload.filter(isRecord);
  if (isRecord(payload) && payload["ok"] === true && Array.isArray(payload["data"])) {
    return payload["data"].filter(isRecord);
  }
  return [];
}

export async function fetchJobList(signal?: AbortSignal): Promise<NormalizedJobSummary[]> {
  const response = await fetch("/api/jobs", { signal });
  const payload = await response.json();
  return extractJobList(payload).map(adaptJobSummary);
}

export function useJobList(): UseJobListResult {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<NormalizedJobSummary[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback((cancelPrevious: boolean) => {
    if (cancelPrevious) abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);

    void fetchJobList(controller.signal)
      .then((jobs) => {
        setData(jobs);
        setError(null);
      })
      .catch((fetchError) => {
        if (fetchError instanceof DOMException && fetchError.name === "AbortError") return;
        setError(toApiError(fetchError));
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    load(true);
    return () => abortRef.current?.abort();
  }, [load]);

  const refetch = useCallback(() => {
    load(false);
  }, [load]);

  return { loading, data, error, refetch };
}
