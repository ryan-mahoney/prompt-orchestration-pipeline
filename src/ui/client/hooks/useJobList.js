import { useState, useEffect, useCallback } from "react";

/**
 * Custom hook for fetching job list from API
 * @returns {Object} Hook state with loading, data, error, and refetch function
 */
export function useJobList() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const fetchJobs = useCallback(async (signal) => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch("/api/jobs", { signal });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();

      if (result.ok) {
        setData(result.data);
      } else {
        throw new Error(result.message || "Failed to fetch jobs");
      }
    } catch (err) {
      if (err.name !== "AbortError") {
        setError(err.message);
        setData(null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const refetch = useCallback(() => {
    const controller = new AbortController();
    fetchJobs(controller.signal);
  }, [fetchJobs]);

  useEffect(() => {
    const controller = new AbortController();
    fetchJobs(controller.signal);

    return () => {
      controller.abort();
    };
  }, [fetchJobs]);

  return {
    loading,
    data,
    error,
    refetch,
  };
}
