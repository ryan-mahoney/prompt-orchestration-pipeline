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
        if (json && typeof json === "object" && "ok" in json) {
          if (json.ok && Array.isArray(json.data)) {
            setData(json.data);
          } else if (!json.ok) {
            setError({ code: json.code, message: json.message });
            setData(null);
          } else {
            // Fallback: data is not an array; treat as empty to avoid crashes
            setData([]);
          }
        } else {
          // Legacy path: response is already an array
          setData(Array.isArray(json) ? json : []);
        }
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
