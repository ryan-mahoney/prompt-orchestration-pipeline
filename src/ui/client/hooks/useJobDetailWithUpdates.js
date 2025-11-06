import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { adaptJobDetail } from "../adapters/job-adapter.js";

// Export debounce constant for tests
export const REFRESH_DEBOUNCE_MS = 200;

/**
 * fetchJobDetail - Extracted fetch logic for job details
 *
 * @param {string} jobId - The job ID to fetch
 * @param {Object} options - Options object
 * @param {AbortSignal} options.signal - Optional abort signal
 * @returns {Promise<Object>} Job data
 */
async function fetchJobDetail(jobId, { signal } = {}) {
  const response = await fetch(`/api/jobs/${jobId}`, { signal });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.message || `HTTP ${response.status}`);
  }

  const result = await response.json();

  if (!result.ok) {
    throw new Error(result.message || "Failed to load job");
  }

  return adaptJobDetail(result.data);
}

/**
 * applyJobEvent - Reducer function to apply SSE events to a single job
 * (pure, no side effects)
 *
 * @param {Object} prev - Previous job state
 * @param {Object} event - SSE event with type and payload
 * @param {string} jobId - Current job ID for filtering
 * @returns {Object} Updated job state
 */
function applyJobEvent(prev = null, event, jobId) {
  if (!event || !event.type) return prev;

  const p = event.payload || {};

  // If this event is for a different job, return unchanged
  if (p.jobId && prev && p.jobId !== prev.jobId) {
    return prev;
  }

  switch (event.type) {
    case "job:created": {
      if (!p.jobId) return prev;
      // If we don't have a job yet, or this matches our job, use it
      if (!prev || prev.jobId === p.jobId) {
        return { ...p };
      }
      return prev;
    }

    case "job:updated": {
      if (!p.jobId) return prev;
      // Only update if this matches our job
      if (!prev || prev.jobId !== p.jobId) {
        return prev;
      }
      const merged = { ...prev, ...p };
      try {
        if (JSON.stringify(merged) === JSON.stringify(prev)) return prev;
      } catch (e) {}
      return merged;
    }

    case "job:removed": {
      if (!p.jobId) return prev;
      // If this is our job, return null to indicate it was removed
      if (prev && prev.jobId === p.jobId) {
        return null;
      }
      return prev;
    }

    case "status:changed": {
      if (!p.jobId) return prev;
      if (!prev || prev.jobId !== p.jobId) return prev;
      const updated = { ...prev, status: p.status };
      try {
        if (JSON.stringify(updated) === JSON.stringify(prev)) return prev;
      } catch (e) {}
      return updated;
    }

    case "state:change": {
      // Direct-apply only (jobId-present). Path-only handling is done by event handler
      const data = p.data || p;
      if (
        data.jobId &&
        data.jobId === jobId &&
        prev &&
        prev.jobId === data.jobId
      ) {
        const merged = { ...prev, ...data };
        try {
          if (JSON.stringify(merged) === JSON.stringify(prev)) return prev;
        } catch (e) {}
        return merged;
      }
      return prev;
    }

    default:
      console.log("XXX: Unknown event type:", event.type);
      return prev;
  }
}

function matchesJobTasksStatusPath(path, jobId) {
  try {
    // Normalize path: convert backslashes to "/", trim whitespace
    const normalizedPath = path.replace(/\\/g, "/").trim();
    const re = new RegExp(
      `(?:^|/)pipeline-data/(current|complete|pending|rejected)/${jobId}/`
    );
    return re.test(normalizedPath);
  } catch {
    return false;
  }
}

/**
 * useJobDetailWithUpdates
 *
 * Hook for fetching and maintaining a single job's state with SSE updates.
 * Filters SSE events to only apply to the specified jobId.
 *
 * @param {string} jobId - The job ID to fetch and monitor
 * @returns {Object} { data, loading, error, connectionStatus }
 */
export function useJobDetailWithUpdates(jobId) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState("disconnected");

  const esRef = useRef(null);
  const reconnectTimer = useRef(null);
  const hydratedRef = useRef(false);
  const eventQueue = useRef([]);
  const mountedRef = useRef(true);
  const refetchTimerRef = useRef(null);

  // Debounced refetch helper (called directly from handlers)
  const scheduleDebouncedRefetch = useCallback(
    (context = {}) => {
      if (refetchTimerRef.current) {
        clearTimeout(refetchTimerRef.current);
      }
      refetchTimerRef.current = setTimeout(async () => {
        if (!mountedRef.current || !hydratedRef.current) {
          return;
        }
        const abortController = new AbortController();
        try {
          const jobData = await fetchJobDetail(jobId, {
            signal: abortController.signal,
          });
          if (mountedRef.current) {
            setData(jobData);
            setError(null);
          }
        } catch (err) {
          if (mountedRef.current) setError(err.message);
        } finally {
          refetchTimerRef.current = null;
        }
      }, REFRESH_DEBOUNCE_MS);
    },
    [jobId]
  );

  // Reset state when jobId changes
  useEffect(() => {
    setData(null);
    setLoading(true);
    setError(null);
    setConnectionStatus("disconnected");
    hydratedRef.current = false;
    eventQueue.current = [];
    if (refetchTimerRef.current) {
      clearTimeout(refetchTimerRef.current);
      refetchTimerRef.current = null;
    }
  }, [jobId]);

  // Fetch job detail on mount and when jobId changes
  useEffect(() => {
    if (!jobId || !mountedRef.current) return;

    const doFetch = async () => {
      try {
        setLoading(true);
        setError(null);

        const jobData = await fetchJobDetail(jobId);

        // Apply any queued events to the fresh data (purely), and detect if a refetch is needed
        let finalData = jobData;
        let queuedNeedsRefetch = false;
        if (eventQueue.current.length > 0) {
          for (const ev of eventQueue.current) {
            if (ev.type === "state:change") {
              const d = (ev.payload && (ev.payload.data || ev.payload)) || {};
              if (
                typeof d.path === "string" &&
                matchesJobTasksStatusPath(d.path, jobId)
              ) {
                queuedNeedsRefetch = true;
                continue; // don't apply to data
              }
            }
            finalData = applyJobEvent(finalData, ev, jobId);
          }
          eventQueue.current = [];
        }

        if (mountedRef.current) {
          setData(finalData);
          setError(null);
          hydratedRef.current = true;

          // Now that we're hydrated, if any queued path-only change was seen, schedule a refetch
          if (queuedNeedsRefetch) {
            scheduleDebouncedRefetch();
          }
        }
      } catch (err) {
        if (mountedRef.current) {
          setError(err.message);
          setData(null);
        }
      } finally {
        if (mountedRef.current) {
          setLoading(false);
        }
      }
    };

    doFetch();
  }, [jobId, scheduleDebouncedRefetch]);

  // Set up SSE connection
  useEffect(() => {
    if (!jobId) {
      return undefined;
    }
    if (esRef.current) {
      try {
        esRef.current.close();
      } catch (err) {}
      esRef.current = null;
    }

    // Helper to attach listeners to a given EventSource instance
    const attachListeners = (es) => {
      const onOpen = () => {
        if (mountedRef.current) {
          setConnectionStatus("connected");
        }
      };

      const onError = () => {
        // Derive state from readyState when possible
        try {
          const rs = esRef.current?.readyState;
          if (rs === 0) {
            if (mountedRef.current) setConnectionStatus("disconnected");
          } else if (rs === 1) {
            if (mountedRef.current) setConnectionStatus("connected");
          } else if (rs === 2) {
            if (mountedRef.current) setConnectionStatus("disconnected");
          } else {
            if (mountedRef.current) setConnectionStatus("disconnected");
          }
        } catch (err) {
          if (mountedRef.current) setConnectionStatus("disconnected");
        }

        // Attempt reconnect after 2s if closed
        if (
          esRef.current &&
          esRef.current.readyState === 2 &&
          mountedRef.current
        ) {
          if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
          reconnectTimer.current = setTimeout(() => {
            if (!mountedRef.current) return;

            try {
              // Close existing reference if any
              try {
                esRef.current?.close();
              } catch (e) {}

              // Create a fresh EventSource and attach the same listeners
              const eventsUrl = jobId
                ? `/api/events?jobId=${encodeURIComponent(jobId)}`
                : "/api/events";
              const newEs = new EventSource(eventsUrl);
              newEs.addEventListener("open", onOpen);
              newEs.addEventListener("job:updated", onJobUpdated);
              newEs.addEventListener("job:created", onJobCreated);
              newEs.addEventListener("job:removed", onJobRemoved);
              newEs.addEventListener("status:changed", onStatusChanged);
              newEs.addEventListener("state:change", onStateChange);
              newEs.addEventListener("error", onError);

              esRef.current = newEs;
            } catch (err) {
              console.error("Failed to reconnect SSE:", err);
            }
          }, 2000);
        }
      };

      const handleIncomingEvent = (type, evt) => {
        try {
          const payload = evt && evt.data ? JSON.parse(evt.data) : null;
          const eventObj = { type, payload };

          // Filter events by jobId - only process events for our job when jobId is present
          if (payload && payload.jobId && payload.jobId !== jobId) {
            return; // Ignore events for other jobs
          }

          if (!hydratedRef.current) {
            // Queue events until hydration completes
            eventQueue.current = (eventQueue.current || []).concat(eventObj);
            return;
          }

          // Path-matching state:change → schedule debounced refetch
          if (type === "state:change") {
            const d = (payload && (payload.data || payload)) || {};
            if (
              typeof d.path === "string" &&
              matchesJobTasksStatusPath(d.path, jobId)
            ) {
              scheduleDebouncedRefetch({
                reason: "state:change",
                path: d.path,
              });
              return; // no direct setData
            }
          }

          // Apply event using pure reducer (includes direct state:change with id)
          setData((prev) => {
            const next = applyJobEvent(prev, eventObj, jobId);
            try {
              if (JSON.stringify(prev) === JSON.stringify(next)) {
                return prev;
              }
            } catch (e) {
              console.error("Error comparing states:", e);
            }
            return next;
          });
        } catch (err) {
          // Non-fatal: keep queue intact and continue
          // eslint-disable-next-line no-console
          console.error("Failed to handle SSE event:", err);
        }
      };

      const onJobUpdated = (evt) => handleIncomingEvent("job:updated", evt);
      const onJobCreated = (evt) => handleIncomingEvent("job:created", evt);
      const onJobRemoved = (evt) => handleIncomingEvent("job:removed", evt);
      const onStatusChanged = (evt) =>
        handleIncomingEvent("status:changed", evt);
      const onStateChange = (evt) => handleIncomingEvent("state:change", evt);

      es.addEventListener("open", onOpen);
      es.addEventListener("job:updated", onJobUpdated);
      es.addEventListener("job:created", onJobCreated);
      es.addEventListener("job:removed", onJobRemoved);
      es.addEventListener("status:changed", onStatusChanged);
      es.addEventListener("state:change", onStateChange);
      es.addEventListener("error", onError);

      // Set connection status from readyState when possible
      if (es.readyState === 1 && mountedRef.current) {
        setConnectionStatus("connected");
      } else if (es.readyState === 0 && mountedRef.current) {
        setConnectionStatus("disconnected");
      }

      return () => {
        try {
          es.removeEventListener("open", onOpen);
          es.removeEventListener("job:updated", onJobUpdated);
          es.removeEventListener("job:created", onJobCreated);
          es.removeEventListener("job:removed", onJobRemoved);
          es.removeEventListener("status:changed", onStatusChanged);
          es.removeEventListener("state:change", onStateChange);
          es.removeEventListener("error", onError);
          es.close();
        } catch (err) {
          console.error("Error during SSE cleanup:", err);
        }
        if (reconnectTimer.current) {
          clearTimeout(reconnectTimer.current);
          reconnectTimer.current = null;
        }
        esRef.current = null;
      };
    };

    // Create EventSource with jobId query parameter for server-side filtering
    try {
      const eventsUrl = jobId
        ? `/api/events?jobId=${encodeURIComponent(jobId)}`
        : "/api/events";
      const es = new EventSource(eventsUrl);
      esRef.current = es;

      const cleanup = attachListeners(es);
      return cleanup;
    } catch (err) {
      console.error("Failed to create SSE connection:", err);
      if (mountedRef.current) {
        setConnectionStatus("error");
      }
      return undefined;
    }
  }, [jobId, scheduleDebouncedRefetch]);

  // Mount/unmount lifecycle: ensure mountedRef is true on mount (StrictMode-safe)
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
        reconnectTimer.current = null;
      }
      if (refetchTimerRef.current) {
        clearTimeout(refetchTimerRef.current);
        refetchTimerRef.current = null;
      }
      if (esRef.current) {
        try {
          esRef.current.close();
        } catch (e) {}
        esRef.current = null;
      }
    };
  }, []);

  return {
    data,
    loading,
    error,
    connectionStatus,
  };
}
