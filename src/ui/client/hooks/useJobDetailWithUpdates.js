import { useState, useEffect, useRef } from "react";

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

  return result.data;
}

/**
 * applyJobEvent - Reducer function to apply SSE events to a single job
 *
 * @param {Object} prev - Previous job state
 * @param {Object} event - SSE event with type and payload
 * @param {string} jobId - Current job ID for filtering
 * @param {Object} refs - Refs object for side effects
 * @returns {Object} Updated job state
 */
function applyJobEvent(prev = null, event, jobId, refs = {}) {
  // prev: Single job object or null
  // event: { type: string, payload: object }
  // jobId: Current job ID for filtering
  // refs: { needsRefetchRef } for side effects

  if (!event || !event.type) return prev;

  const p = event.payload || {};
  const { needsRefetchRef } = refs;

  // If this event is for a different job, return unchanged
  if (p.id && prev && p.id !== prev.id) {
    return prev;
  }

  switch (event.type) {
    case "job:created": {
      if (!p.id) return prev;
      // If we don't have a job yet, or this matches our job, use it
      if (!prev || prev.id === p.id) {
        return { ...p };
      }
      return prev;
    }

    case "job:updated": {
      if (!p.id) return prev;
      // Only update if this matches our job
      if (!prev || prev.id !== p.id) {
        return prev;
      }
      const merged = { ...prev, ...p };
      try {
        if (JSON.stringify(merged) === JSON.stringify(prev)) return prev;
      } catch (e) {
        // ignore stringify errors
      }
      return merged;
    }

    case "job:removed": {
      if (!p.id) return prev;
      // If this is our job, return null to indicate it was removed
      if (prev && prev.id === p.id) {
        return null;
      }
      return prev;
    }

    case "status:changed": {
      if (!p.id) return prev;
      // Only update status if this matches our job
      if (!prev || prev.id !== p.id) {
        return prev;
      }
      const updated = { ...prev, status: p.status };
      try {
        if (JSON.stringify(updated) === JSON.stringify(prev)) return prev;
      } catch (e) {}
      return updated;
    }

    case "state:change": {
      // Handle state:change events with dual-path logic
      const data = p.data || p;

      // Direct apply: payload.id matches current jobId
      if (data.id && data.id === jobId) {
        if (!prev || prev.id !== data.id) {
          return prev;
        }
        const merged = { ...prev, ...data };
        try {
          if (JSON.stringify(merged) === JSON.stringify(prev)) return prev;
        } catch (e) {
          // ignore stringify errors
        }
        return merged;
      }

      // Path-only: check if path contains our job's tasks-status.json
      if (data.path && typeof data.path === "string") {
        const jobPathPattern = new RegExp(
          `/pipeline-data/(current|complete|pending|rejected)/${jobId}/tasks-status\\.json$`
        );
        if (jobPathPattern.test(data.path)) {
          // Schedule debounced refetch via needsRefetchRef flag
          needsRefetchRef.current = true;
          // The actual debounced fetch will be handled by the debounced refetch logic
        }
      }

      return prev;
    }

    default:
      return prev;
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
  const needsRefetchRef = useRef(false);

  // Reset state when jobId changes
  useEffect(() => {
    setData(null);
    setLoading(true);
    setError(null);
    setConnectionStatus("disconnected");
    hydratedRef.current = false;
    eventQueue.current = [];
  }, [jobId]);

  // Fetch job detail on mount and when jobId changes
  useEffect(() => {
    if (!jobId || !mountedRef.current) return;

    const doFetch = async () => {
      try {
        setLoading(true);
        setError(null);

        const jobData = await fetchJobDetail(jobId);

        // Apply any queued events to the fresh data
        let finalData = jobData;
        if (eventQueue.current.length > 0) {
          try {
            finalData = eventQueue.current.reduce(
              (acc, ev) => applyJobEvent(acc, ev, jobId, { needsRefetchRef }),
              jobData
            );
          } catch (e) {
            // eslint-disable-next-line no-console
            console.error(
              "[useJobDetailWithUpdates] failed applying queued events",
              e
            );
          }
          eventQueue.current = [];
        }

        if (mountedRef.current) {
          setData(finalData);
          setError(null);
          hydratedRef.current = true;
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("Failed to fetch job detail:", err);
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
  }, [jobId]);

  // Set up SSE connection
  useEffect(() => {
    if (!jobId || esRef.current || !mountedRef.current) {
      return undefined;
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
              } catch (e) {
                // ignore
              }

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
              // ignore
            }
          }, 2000);
        }
      };

      const handleIncomingEvent = (type, evt) => {
        try {
          const payload = evt && evt.data ? JSON.parse(evt.data) : null;
          const eventObj = { type, payload };

          // Filter events by jobId - only process events for our job
          if (payload && payload.id && payload.id !== jobId) {
            return; // Ignore events for other jobs
          }

          if (!hydratedRef.current) {
            // Queue events until hydration completes
            eventQueue.current = (eventQueue.current || []).concat(eventObj);
            return;
          }

          // Apply event using pure reducer
          setData((prev) => {
            const next = applyJobEvent(prev, eventObj, jobId, {
              needsRefetchRef,
            });
            try {
              if (JSON.stringify(prev) === JSON.stringify(next)) {
                return prev;
              }
            } catch (e) {
              // If stringify fails, fall back to returning next
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
          // ignore
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

      return attachListeners(es);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("Failed to create SSE connection:", err);
      if (mountedRef.current) {
        setConnectionStatus("error");
      }
      return undefined;
    }
  }, [jobId]);

  // Debounced refetch logic for path-only state:change events
  useEffect(() => {
    if (!jobId || !mountedRef.current || !hydratedRef.current) {
      return;
    }

    const scheduleRefetch = () => {
      if (refetchTimerRef.current) {
        clearTimeout(refetchTimerRef.current);
      }

      refetchTimerRef.current = setTimeout(async () => {
        if (!mountedRef.current || !hydratedRef.current) {
          return;
        }

        try {
          const jobData = await fetchJobDetail(jobId);
          if (mountedRef.current) {
            setData(jobData);
            setError(null);
          }
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error("Failed to refetch job detail:", err);
          if (mountedRef.current) {
            setError(err.message);
          }
        } finally {
          needsRefetchRef.current = false;
          refetchTimerRef.current = null;
        }
      }, REFRESH_DEBOUNCE_MS);
    };

    if (needsRefetchRef.current) {
      scheduleRefetch();
    }

    return () => {
      if (refetchTimerRef.current) {
        clearTimeout(refetchTimerRef.current);
        refetchTimerRef.current = null;
      }
    };
  }, [jobId, needsRefetchRef.current, hydratedRef.current]);

  // Cleanup on unmount
  useEffect(() => {
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
        } catch (e) {
          // ignore
        }
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
