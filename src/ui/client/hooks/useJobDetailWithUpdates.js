import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { adaptJobDetail } from "../adapters/job-adapter.js";

// Export debounce constant for tests
export const REFRESH_DEBOUNCE_MS = 200;

// Instrumentation helper for useJobDetailWithUpdates
const createHookLogger = (jobId) => {
  const prefix = `[useJobDetailWithUpdates:${jobId || "unknown"}]`;
  return {
    log: (message, data = null) => {
      console.log(`${prefix} ${message}`, data ? data : "");
    },
    warn: (message, data = null) => {
      console.warn(`${prefix} ${message}`, data ? data : "");
    },
    error: (message, data = null) => {
      console.error(`${prefix} ${message}`, data ? data : "");
    },
    group: (label) => console.group(`${prefix} ${label}`),
    groupEnd: () => console.groupEnd(),
    table: (data, title) => {
      console.log(`${prefix} ${title}:`);
      console.table(data);
    },
    sse: (eventType, eventData) => {
      console.log(
        `%c${prefix} SSE Event: ${eventType}`,
        "color: #0066cc; font-weight: bold;",
        eventData
      );
    },
    state: (stateName, value) => {
      console.log(
        `%c${prefix} State Change: ${stateName}`,
        "color: #006600; font-weight: bold;",
        value
      );
    },
  };
};

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
  const logger = useMemo(() => createHookLogger(jobId), [jobId]);

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

  // Log hook initialization and state changes
  useEffect(() => {
    logger.group("Hook Initialization");
    logger.log("Job ID:", jobId);
    logger.log("Initial state:", { data, loading, error, connectionStatus });
    logger.groupEnd();
  }, [jobId, logger]);

  useEffect(() => {
    logger.state("data", data);
  }, [data, logger]);

  useEffect(() => {
    logger.state("loading", loading);
  }, [loading, logger]);

  useEffect(() => {
    logger.state("error", error);
  }, [error, logger]);

  useEffect(() => {
    logger.state("connectionStatus", connectionStatus);
  }, [connectionStatus, logger]);

  // Debounced refetch helper (called directly from handlers)
  const scheduleDebouncedRefetch = useCallback(
    (context = {}) => {
      logger.group("Debounced Refetch Request");
      logger.log("Request context:", context);
      logger.log("Scheduling debounced refetch");
      if (refetchTimerRef.current) {
        logger.log("Clearing existing refetch timer");
        clearTimeout(refetchTimerRef.current);
      }
      refetchTimerRef.current = setTimeout(async () => {
        if (!mountedRef.current || !hydratedRef.current) {
          logger.warn(
            "Refetch aborted - component not mounted or not hydrated",
            { mounted: mountedRef.current, hydrated: hydratedRef.current }
          );
          logger.groupEnd();
          return;
        }
        logger.log("Executing debounced refetch");
        logger.log("Refetch jobId:", jobId);
        const abortController = new AbortController();
        try {
          const jobData = await fetchJobDetail(jobId, {
            signal: abortController.signal,
          });
          logger.log("Refetch response received");
          logger.log("Refetch job data preview:", {
            status: jobData?.status,
            hasTasks: !!jobData?.tasks,
            taskKeys: jobData?.tasks ? Object.keys(jobData.tasks) : [],
            hasTasksStatus: !!jobData?.tasksStatus,
          });
          if (mountedRef.current) {
            logger.log("Refetch successful, updating data");
            setData(jobData);
            setError(null);
          } else {
            logger.warn("Refetch completed but component is unmounted");
          }
        } catch (err) {
          logger.error("Failed to refetch job detail:", err);
          if (mountedRef.current) setError(err.message);
        } finally {
          refetchTimerRef.current = null;
          logger.groupEnd();
        }
      }, REFRESH_DEBOUNCE_MS);
    },
    [jobId, logger]
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
      logger.group("Initial Data Fetch");
      try {
        setLoading(true);
        setError(null);
        logger.log("Starting initial job data fetch");

        const jobData = await fetchJobDetail(jobId);
        logger.log("Initial fetch successful", jobData);

        // Apply any queued events to the fresh data (purely), and detect if a refetch is needed
        let finalData = jobData;
        let queuedNeedsRefetch = false;
        if (eventQueue.current.length > 0) {
          logger.log(`Processing ${eventQueue.current.length} queued events`);
          for (const ev of eventQueue.current) {
            logger.log("Processing queued event:", ev);
            if (ev.type === "state:change") {
              const d = (ev.payload && (ev.payload.data || ev.payload)) || {};
              if (
                typeof d.path === "string" &&
                matchesJobTasksStatusPath(d.path, jobId)
              ) {
                logger.log(
                  "Queued state:change matches tasks-status path, scheduling refetch"
                );
                queuedNeedsRefetch = true;
                continue; // don't apply to data
              }
            }
            finalData = applyJobEvent(finalData, ev, jobId);
            logger.log("Applied queued event, result:", finalData);
          }
          eventQueue.current = [];
        }

        if (mountedRef.current) {
          logger.log("Updating state with final data");
          setData(finalData);
          setError(null);
          hydratedRef.current = true;
          logger.log("Component hydrated");

          // Now that we're hydrated, if any queued path-only change was seen, schedule a refetch
          if (queuedNeedsRefetch) {
            logger.log("Scheduling refetch for queued path changes");
            scheduleDebouncedRefetch();
          }
        }
      } catch (err) {
        logger.error("Failed to fetch job detail:", err);
        if (mountedRef.current) {
          setError(err.message);
          setData(null);
        }
      } finally {
        if (mountedRef.current) {
          setLoading(false);
        }
        logger.groupEnd();
      }
    };

    doFetch();
  }, [jobId, scheduleDebouncedRefetch, logger]);

  // Set up SSE connection
  useEffect(() => {
    if (!jobId) {
      logger.log("SSE setup skipped - no jobId available", {
        hasJobId: !!jobId,
        hasExistingEs: !!esRef.current,
        isMounted: mountedRef.current,
      });
      return undefined;
    }
    if (esRef.current) {
      logger.log("Closing existing EventSource before reinitializing");
      try {
        esRef.current.close();
      } catch (err) {
        logger.warn("Error closing existing EventSource during reinit", err);
      }
      esRef.current = null;
    }

    logger.group("SSE Connection Setup");
    logger.log("Setting up SSE connection for job:", jobId);

    // Helper to attach listeners to a given EventSource instance
    const attachListeners = (es) => {
      const onOpen = () => {
        logger.log("SSE connection opened");
        if (mountedRef.current) {
          setConnectionStatus("connected");
        }
      };

      const onError = () => {
        logger.warn("SSE connection error");
        // Derive state from readyState when possible
        try {
          const rs = esRef.current?.readyState;
          logger.log("SSE readyState:", rs);
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
          logger.error("Error getting readyState:", err);
          if (mountedRef.current) setConnectionStatus("disconnected");
        }

        // Attempt reconnect after 2s if closed
        if (
          esRef.current &&
          esRef.current.readyState === 2 &&
          mountedRef.current
        ) {
          logger.log("Scheduling SSE reconnection");
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
              logger.log("Creating new EventSource for reconnection");
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
              logger.error("Failed to reconnect SSE:", err);
            }
          }, 2000);
        }
      };

      const handleIncomingEvent = (type, evt) => {
        try {
          const payload = evt && evt.data ? JSON.parse(evt.data) : null;
          const eventObj = { type, payload };

          logger.sse(type, payload);

          // Filter events by jobId - only process events for our job when jobId is present
          if (payload && payload.jobId && payload.jobId !== jobId) {
            logger.log(
              `Ignoring event for different job: ${payload.jobId} (current: ${jobId})`
            );
            return; // Ignore events for other jobs
          }

          if (!hydratedRef.current) {
            logger.log(`Queueing event until hydration: ${type}`);
            // Queue events until hydration completes
            eventQueue.current = (eventQueue.current || []).concat(eventObj);
            return;
          }

          // Path-matching state:change → schedule debounced refetch
          if (type === "state:change") {
            const d = (payload && (payload.data || payload)) || {};
            logger.log("Processing state:change event:", d);
            if (
              typeof d.path === "string" &&
              matchesJobTasksStatusPath(d.path, jobId)
            ) {
              logger.log(
                `state:change matches tasks-status path: ${d.path}, scheduling refetch`
              );
              scheduleDebouncedRefetch({
                reason: "state:change",
                path: d.path,
              });
              return; // no direct setData
            } else {
              logger.log(
                `state:change does not match tasks-status path: ${d.path}`
              );
            }
          }

          // Apply event using pure reducer (includes direct state:change with id)
          setData((prev) => {
            logger.group("Applying SSE event to state");
            logger.log("Previous state snapshot:", {
              hasTasks: !!prev?.tasks,
              taskKeys: prev?.tasks ? Object.keys(prev.tasks) : [],
              status: prev?.status,
            });
            logger.log("Incoming event payload:", payload);
            const next = applyJobEvent(prev, eventObj, jobId);
            try {
              if (JSON.stringify(prev) === JSON.stringify(next)) {
                logger.log("Event application resulted in no state change");
                logger.groupEnd();
                return prev;
              }
            } catch (e) {
              logger.error("Error comparing states:", e);
            }
            logger.log("Event applied, state updated", {
              hasTasks: !!next?.tasks,
              taskKeys: next?.tasks ? Object.keys(next.tasks) : [],
              status: next?.status,
            });
            logger.groupEnd();
            return next;
          });
        } catch (err) {
          logger.error("Failed to handle SSE event:", err);
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

      logger.log("Attaching SSE event listeners");
      es.addEventListener("open", onOpen);
      es.addEventListener("job:updated", onJobUpdated);
      es.addEventListener("job:created", onJobCreated);
      es.addEventListener("job:removed", onJobRemoved);
      es.addEventListener("status:changed", onStatusChanged);
      es.addEventListener("state:change", onStateChange);
      es.addEventListener("error", onError);

      // Set connection status from readyState when possible
      if (es.readyState === 1 && mountedRef.current) {
        logger.log("SSE already open, setting connected");
        setConnectionStatus("connected");
      } else if (es.readyState === 0 && mountedRef.current) {
        logger.log("SSE connecting, setting disconnected");
        setConnectionStatus("disconnected");
      }

      return () => {
        logger.log("Cleaning up SSE connection");
        try {
          es.removeEventListener("open", onOpen);
          es.removeEventListener("job:updated", onJobUpdated);
          es.removeEventListener("job:created", onJobCreated);
          es.removeEventListener("job:removed", onJobRemoved);
          es.removeEventListener("status:changed", onStatusChanged);
          es.removeEventListener("state:change", onStateChange);
          es.removeEventListener("error", onError);
          es.close();
          logger.log("SSE connection closed");
        } catch (err) {
          logger.error("Error during SSE cleanup:", err);
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
      logger.log(`Creating EventSource with URL: ${eventsUrl}`);
      const es = new EventSource(eventsUrl);
      esRef.current = es;

      const cleanup = attachListeners(es);
      logger.groupEnd(); // End SSE Connection Setup group
      return cleanup;
    } catch (err) {
      logger.error("Failed to create SSE connection:", err);
      if (mountedRef.current) {
        setConnectionStatus("error");
      }
      logger.groupEnd(); // End SSE Connection Setup group
      return undefined;
    }
  }, [jobId, scheduleDebouncedRefetch, logger]);

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
