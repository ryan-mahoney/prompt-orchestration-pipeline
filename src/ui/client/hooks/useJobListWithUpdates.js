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
  // prev: Array of jobs
  // event: { type: string, payload: object }
  const list = Array.isArray(prev) ? prev.slice() : [];

  if (!event || !event.type) return list;

  const p = event.payload || {};
  switch (event.type) {
    case "job:created": {
      if (!p.id) return list;
      const idx = list.findIndex((j) => j.id === p.id);
      if (idx === -1) {
        list.push(p);
      } else {
        list[idx] = { ...list[idx], ...p };
      }
      return sortJobs(list);
    }

    case "job:updated": {
      if (!p.id) return list;
      const idx = list.findIndex((j) => j.id === p.id);
      if (idx === -1) {
        // If we don't have it yet, add it
        list.push(p);
      } else {
        list[idx] = { ...list[idx], ...p };
      }
      return sortJobs(list);
    }

    case "job:removed": {
      if (!p.id) return list;
      return list.filter((j) => j.id !== p.id);
    }

    case "status:changed": {
      if (!p.id) return list;
      return list.map((j) => (j.id === p.id ? { ...j, status: p.status } : j));
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
      hydratedRef.current = true;

      if (eventQueue.current.length > 0) {
        setLocalData((prev) => {
          return eventQueue.current.reduce(
            (acc, ev) => applyJobEvent(acc, ev),
            Array.isArray(prev) ? prev : []
          );
        });
        eventQueue.current = [];
      }
    } else {
      hydratedRef.current = false;
    }
  }, [data]);

  useEffect(() => {
    if (!data || !Array.isArray(data) || data.length === 0) {
      // Do not open SSE when no data (snapshot required)
      return undefined;
    }

    // Create EventSource
    try {
      const es = new EventSource("/api/events");
      esRef.current = es;

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
              esRef.current = new EventSource("/api/events");
              // Effect cleanup/setup cycle will reattach listeners on next render if needed
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
            // Queue events and apply after hydration to avoid race conditions
            eventQueue.current.push(eventObj);
            return;
          }

          setLocalData((prev) => applyJobEvent(prev, eventObj));
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
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("Failed to create SSE connection:", err);
      setConnectionStatus("error");
      return undefined;
    }
  }, [data]);

  return {
    loading,
    data: localData,
    error,
    refetch,
    connectionStatus,
  };
}
