import { useState, useEffect, useRef } from "react";
import { useJobList } from "./useJobList.js";
import { sortJobs } from "../../transformers/list-transformer.js";

/**
 * useJobListWithUpdates
 *
 * - Uses useJobList to fetch initial data
 * - When data is available and non-empty, opens an EventSource to /api/events
 * - Listens for 'job:updated' events and merges updates into local list by id
 * - Maintains connectionStatus: 'disconnected' | 'connected' | 'error'
 * - Cleans up EventSource on unmount
 */
export function useJobListWithUpdates() {
  const base = useJobList();
  const { loading, data, error, refetch } = base;

  const [localData, setLocalData] = useState(data || null);
  const [connectionStatus, setConnectionStatus] = useState("disconnected");
  const esRef = useRef(null);
  const reconnectTimer = useRef(null);

  // Keep localData in sync when base data changes
  useEffect(() => {
    setLocalData(data || null);
  }, [data]);

  useEffect(() => {
    if (!data || !Array.isArray(data) || data.length === 0) {
      // Do not open SSE when no data
      return undefined;
    }

    // Create EventSource
    try {
      const es = new EventSource("/api/events");
      esRef.current = es;
      setConnectionStatus("disconnected");

      const onOpen = () => {
        setConnectionStatus("connected");
      };

      const onError = () => {
        setConnectionStatus("disconnected");
        // Attempt reconnect after 2s if closed
        if (esRef.current && esRef.current.readyState === 2) {
          // Closed - try to reconnect
          if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
          reconnectTimer.current = setTimeout(() => {
            try {
              esRef.current = new EventSource("/api/events");
              // listeners will be reattached by effect cleanup/setup cycle
            } catch (err) {
              // ignore
            }
          }, 2000);
        }
      };

      const onJobUpdated = (evt) => {
        try {
          const payload = JSON.parse(evt.data);
          if (!payload || !payload.id) return;
          setLocalData((prev) => {
            const list = Array.isArray(prev) ? prev.slice() : [];
            const idx = list.findIndex((j) => j.id === payload.id);
            if (idx === -1) {
              list.push(payload);
            } else {
              list[idx] = { ...list[idx], ...payload };
            }
            // Preserve stable sort using sortJobs
            return sortJobs(list);
          });
        } catch (err) {
          console.error("Failed to parse job update event:", err);
        }
      };

      es.addEventListener("open", onOpen);
      es.addEventListener("job:updated", onJobUpdated);
      es.addEventListener("error", onError);

      // set connected if readyState open
      if (es.readyState === 1) setConnectionStatus("connected");

      return () => {
        try {
          es.removeEventListener("open", onOpen);
          es.removeEventListener("job:updated", onJobUpdated);
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
