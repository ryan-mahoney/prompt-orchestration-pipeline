import { useState, useCallback, useEffect } from "react";

/**
 * Simple fetch hook for /api/jobs
 * Exposes: { loading, data, error, refetch }
 */
export function useJobList() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const fetchJobs = useCallback(async (signal) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/jobs", { signal });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        setError(payload);
        setData(null);
      } else {
        const json = await res.json();
        setData(json);
      }
    } catch (err) {
      if (err.name === "AbortError") {
        // ignore
      } else {
        setError({ message: err.message });
        setData(null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const refetch = useCallback(() => {
    const controller = new AbortController();
    void fetchJobs(controller.signal);
    // no persistence of controller here - immediate refetch
  }, [fetchJobs]);

  useEffect(() => {
    const controller = new AbortController();
    void fetchJobs(controller.signal);
    return () => controller.abort();
  }, [fetchJobs]);

  return { loading, data, error, refetch };
}
