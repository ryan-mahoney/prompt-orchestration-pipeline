import { useState, useEffect, useRef } from "react";
import { useJobList } from "./useJobList.js";
import { sortJobs } from "../../transformers/list-transformer.js";

/**
 * useJobListWithUpdates
 *
 * - Uses useJobList to fetch initial data (or a snapshot)
 * - Hydrates local state from base data, then listens for SSE incremental events
 * - Applies SSE events idempotently via pure reducer functions
 * - Maintains connectionStatus derived from EventSource.readyState
 * - Queues events received before hydration completes and applies them after hydrate
 */
function applyJobEvent(prev = [], event) {
  // prev: Array of jobs (treated immutably)
  // event: { type: string, payload: object }
  const list = Array.isArray(prev) ? prev.slice() : [];

  if (!event || !event.type) return list;

  const p = event.payload || {};
  switch (event.type) {
    case "job:created": {
      if (!p.id) return list;
      const idx = list.findIndex((j) => j.id === p.id);
      if (idx === -1) {
        // New job: add and sort
        list.push(p);
        return sortJobs(list);
      } else {
        // Merge with existing; if no effective change, return prev to avoid unnecessary updates
        const merged = { ...list[idx], ...p };
        try {
          if (JSON.stringify(merged) === JSON.stringify(list[idx])) return prev;
        } catch (e) {
          // Fall back to returning merged result if JSON stringify fails
        }
        list[idx] = merged;
        return sortJobs(list);
      }
    }

    case "job:updated": {
      if (!p.id) return list;
      const idx = list.findIndex((j) => j.id === p.id);
      if (idx === -1) {
        // If we don't have it yet, add it
        list.push(p);
        return sortJobs(list);
      } else {
        const merged = { ...list[idx], ...p };
        try {
          if (JSON.stringify(merged) === JSON.stringify(list[idx])) return prev;
        } catch (e) {
          // ignore stringify errors
        }
        list[idx] = merged;
        return sortJobs(list);
      }
    }

    case "job:removed": {
      if (!p.id) return list;
      const filtered = list.filter((j) => j.id !== p.id);
      // If nothing removed, return prev
      try {
        if (JSON.stringify(filtered) === JSON.stringify(prev)) return prev;
      } catch (e) {}
      return filtered;
    }

    case "status:changed": {
      if (!p.id) return list;
      const mapped = list.map((j) =>
        j.id === p.id ? { ...j, status: p.status } : j
      );
      try {
        if (JSON.stringify(mapped) === JSON.stringify(prev)) return prev;
      } catch (e) {}
      return mapped;
    }

    default:
      return list;
  }
}

export function useJobListWithUpdates() {
  const base = useJobList();
  const { loading, data, error, refetch } = base;

  const [localData, setLocalData] = useState(data || null);
  const [connectionStatus, setConnectionStatus] = useState("disconnected");
  const esRef = useRef(null);
  const reconnectTimer = useRef(null);

  // Hydration guard and event queue for events that arrive before hydration completes.
  const hydratedRef = useRef(false);
  const eventQueue = useRef([]);

  // Keep localData in sync when base data changes (this is the hydration point).
  useEffect(() => {
    setLocalData(data || null);

    if (data && Array.isArray(data)) {
      // Compute hydrated base from incoming data, then apply any queued events deterministically
      const base = Array.isArray(data) ? data.slice() : [];
      if (eventQueue.current.length > 0) {
        // eslint-disable-next-line no-console
        console.debug(
          "[useJobListWithUpdates] applying queued events to base:",
          eventQueue.current.length
        );
        try {
          const applied = eventQueue.current.reduce(
            (acc, ev) => applyJobEvent(acc, ev),
            base
          );
          // Debug: show applied array content for test troubleshooting
          // eslint-disable-next-line no-console
          console.debug(
            "[useJobListWithUpdates] applied jobs count:",
            Array.isArray(applied) ? applied.length : 0,
            "applied:",
            applied
          );
          setLocalData(applied);
        } catch (e) {
          // eslint-disable-next-line no-console
          console.error(
            "[useJobListWithUpdates] failed applying queued events",
            e
          );
          // Fallback: set base as localData
          setLocalData(base);
        }
        eventQueue.current = [];
        hydratedRef.current = true;
        // eslint-disable-next-line no-console
        console.debug("[useJobListWithUpdates] queued events applied");
      } else {
        // No queued events: just hydrate to base
        setLocalData(base);
        hydratedRef.current = true;
      }
    } else {
      hydratedRef.current = false;
    }
  }, [data]);

  useEffect(() => {
    // Only create one EventSource per mounted hook instance
    if (esRef.current) {
      return undefined;
    }

    // Helper to attach listeners to a given EventSource instance
    const attachListeners = (es) => {
      const onOpen = () => {
        setConnectionStatus("connected");
      };

      const onError = () => {
        // Derive state from readyState when possible
        try {
          const rs = esRef.current?.readyState;
          if (rs === 0) {
            // connecting
            setConnectionStatus("disconnected");
          } else if (rs === 1) {
            setConnectionStatus("connected");
          } else if (rs === 2) {
            setConnectionStatus("disconnected");
          } else {
            setConnectionStatus("disconnected");
          }
        } catch (err) {
          setConnectionStatus("disconnected");
        }

        // Attempt reconnect after 2s if closed
        if (esRef.current && esRef.current.readyState === 2) {
          if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
          reconnectTimer.current = setTimeout(() => {
            try {
              // Close existing reference if any
              try {
                esRef.current?.close();
              } catch (e) {
                // ignore
              }

              // Create a fresh EventSource and attach the same listeners so reconnect works
              const newEs = new EventSource("/api/events");
              newEs.addEventListener("open", onOpen);
              newEs.addEventListener("job:updated", onJobUpdated);
              newEs.addEventListener("job:created", onJobCreated);
              newEs.addEventListener("job:removed", onJobRemoved);
              newEs.addEventListener("status:changed", onStatusChanged);
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

          if (!hydratedRef.current) {
            // Queue events functionally (avoid mutating existing array in place)
            // eslint-disable-next-line no-console
            console.debug(
              "[useJobListWithUpdates] queueing event before hydration:",
              type,
              evt && evt.data
            );
            eventQueue.current = (eventQueue.current || []).concat(eventObj);
            return;
          }

          // Apply event using pure reducer. If reducer returns an unchanged value,
          // return prev to avoid unnecessary re-renders.
          setLocalData((prev) => {
            const next = applyJobEvent(prev, eventObj);
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
          // Logging for visibility in dev; tests should mock console if asserting logs
          // eslint-disable-next-line no-console
          if (type === "job:updated") {
            console.error("Failed to parse job update event:", err);
          } else {
            console.error("Failed to handle SSE event:", err);
          }
        }
      };

      const onJobUpdated = (evt) => handleIncomingEvent("job:updated", evt);
      const onJobCreated = (evt) => handleIncomingEvent("job:created", evt);
      const onJobRemoved = (evt) => handleIncomingEvent("job:removed", evt);
      const onStatusChanged = (evt) =>
        handleIncomingEvent("status:changed", evt);

      es.addEventListener("open", onOpen);
      es.addEventListener("job:updated", onJobUpdated);
      es.addEventListener("job:created", onJobCreated);
      es.addEventListener("job:removed", onJobRemoved);
      es.addEventListener("status:changed", onStatusChanged);
      es.addEventListener("error", onError);

      // Set connection status from readyState when possible
      if (es.readyState === 1) setConnectionStatus("connected");
      else if (es.readyState === 0) setConnectionStatus("disconnected");

      return () => {
        try {
          es.removeEventListener("open", onOpen);
          es.removeEventListener("job:updated", onJobUpdated);
          es.removeEventListener("job:created", onJobCreated);
          es.removeEventListener("job:removed", onJobRemoved);
          es.removeEventListener("status:changed", onStatusChanged);
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

    // Create EventSource on mount regardless of base snapshot presence
    try {
      const es = new EventSource("/api/events");
      esRef.current = es;

      // attach listeners and return the cleanup function
      return attachListeners(es);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("Failed to create SSE connection:", err);
      setConnectionStatus("error");
      return undefined;
    }
  }, []);

  return {
    loading,
    data: localData,
    error,
    refetch,
    connectionStatus,
  };
}
