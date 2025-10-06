import { useState, useEffect, useCallback, useRef } from "react";
import { useJobList } from "./useJobList.js";

// Define numeric fallbacks for EventSource constants
const OPEN =
  typeof EventSource !== "undefined" && EventSource.OPEN != null
    ? EventSource.OPEN
    : 1;
const CLOSED =
  typeof EventSource !== "undefined" && EventSource.CLOSED != null
    ? EventSource.CLOSED
    : 2;

/**
 * Custom hook for fetching job list with real-time updates via SSE
 * @returns {Object} Hook state with loading, data, error, refetch function, and connection status
 */
export function useJobListWithUpdates() {
  const { loading, data, error, refetch } = useJobList();
  const [localData, setLocalData] = useState(data);
  const [connectionStatus, setConnectionStatus] = useState("disconnected");
  const eventSourceRef = useRef(null);
  const reconnectTimerRef = useRef(null);

  const mergeJobUpdate = useCallback((currentJobs, updatedJob) => {
    if (!currentJobs) return [updatedJob];

    const existingIndex = currentJobs.findIndex(
      (job) => job.id === updatedJob.id
    );

    if (existingIndex >= 0) {
      // Update existing job
      const updatedJobs = [...currentJobs];
      updatedJobs[existingIndex] = updatedJob;
      return updatedJobs;
    } else {
      // Add new job
      return [...currentJobs, updatedJob];
    }
  }, []);

  const handleJobUpdate = useCallback(
    (event) => {
      try {
        const updatedJob = JSON.parse(event.data);

        // Update the job list with the new job data
        setLocalData((prevData) => mergeJobUpdate(prevData, updatedJob));
      } catch (err) {
        console.error("Failed to parse job update event:", err);
      }
    },
    [mergeJobUpdate]
  );

  const connectSSE = useCallback(() => {
    // Prevent reconnect storms and double connects
    if (
      eventSourceRef.current &&
      eventSourceRef.current.readyState !== CLOSED
    ) {
      return;
    }

    // Clean up existing connection and timer
    if (eventSourceRef.current) {
      // Remove listeners from old instance before closing
      if (eventSourceRef.current._onOpen) {
        eventSourceRef.current.removeEventListener(
          "open",
          eventSourceRef.current._onOpen
        );
      }
      if (eventSourceRef.current._onUpdate) {
        eventSourceRef.current.removeEventListener(
          "job:updated",
          eventSourceRef.current._onUpdate
        );
      }
      if (eventSourceRef.current._onError) {
        eventSourceRef.current.removeEventListener(
          "error",
          eventSourceRef.current._onError
        );
      }
      eventSourceRef.current.close();
    }

    // Always clear any existing reconnect timer
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }

    // Only connect when there's data to watch
    if (!data || data.length === 0) {
      return;
    }

    try {
      setConnectionStatus("connecting");

      const newEventSource = new EventSource("/api/events");

      // Store named listener functions for cleanup
      const onOpen = () => {
        setConnectionStatus("connected");
      };

      const onUpdate = handleJobUpdate;

      const onError = (error) => {
        console.error("SSE connection error:", error);

        if (newEventSource.readyState === CLOSED) {
          setConnectionStatus("disconnected");
          // Schedule reconnect after 2 seconds
          if (reconnectTimerRef.current) {
            clearTimeout(reconnectTimerRef.current);
          }
          reconnectTimerRef.current = setTimeout(connectSSE, 2000);
        }
      };

      // Store references to listeners on the event source for cleanup
      newEventSource._onOpen = onOpen;
      newEventSource._onUpdate = onUpdate;
      newEventSource._onError = onError;

      // Set connection status immediately if already open
      if (newEventSource.readyState === OPEN) {
        setConnectionStatus("connected");
      }

      newEventSource.addEventListener("open", onOpen);
      newEventSource.addEventListener("job:updated", onUpdate);
      newEventSource.addEventListener("error", onError);

      eventSourceRef.current = newEventSource;
    } catch (err) {
      console.error("Failed to create SSE connection:", err);
      setConnectionStatus("error");
    }
  }, [handleJobUpdate, data]);

  useEffect(() => {
    // Only connect SSE if we have data (jobs to watch)
    if (data && data.length > 0) {
      connectSSE();
    }

    return () => {
      // Clean up SSE connection and timer on unmount
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };
  }, [data, connectSSE]);

  // Sync localData with initial data from useJobList
  useEffect(() => {
    if (data && Array.isArray(data)) {
      setLocalData(data);
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
