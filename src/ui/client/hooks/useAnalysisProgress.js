import { useState, useRef, useCallback } from "react";
import { fetchSSE } from "../sse-fetch.js";

const initialState = {
  status: "idle",
  pipelineSlug: null,
  totalTasks: 0,
  completedTasks: 0,
  totalArtifacts: 0,
  completedArtifacts: 0,
  currentTask: null,
  currentArtifact: null,
  error: null,
};

/**
 * useAnalysisProgress - Hook for managing pipeline analysis progress via SSE
 *
 * Provides state and controls for triggering pipeline analysis with real-time
 * progress updates via Server-Sent Events.
 *
 * @returns {Object} { ...state, startAnalysis, reset }
 */
export function useAnalysisProgress() {
  const [state, setState] = useState(initialState);
  const cancelRef = useRef(null);

  const reset = useCallback(() => {
    if (cancelRef.current) {
      cancelRef.current();
      cancelRef.current = null;
    }
    setState(initialState);
  }, []);

  const handleEvent = useCallback((event, data) => {
    switch (event) {
      case "started":
        setState((prev) => ({
          ...prev,
          status: "running",
          pipelineSlug: data.pipelineSlug || prev.pipelineSlug,
          totalTasks: data.totalTasks || 0,
          totalArtifacts: data.totalArtifacts || 0,
        }));
        break;

      case "task:start":
        setState((prev) => ({
          ...prev,
          currentTask: data.taskId || null,
        }));
        break;

      case "artifact:start":
        setState((prev) => ({
          ...prev,
          currentArtifact: data.artifactName || null,
        }));
        break;

      case "artifact:complete":
        setState((prev) => ({
          ...prev,
          completedArtifacts: prev.completedArtifacts + 1,
        }));
        break;

      case "task:complete":
        setState((prev) => ({
          ...prev,
          completedTasks: prev.completedTasks + 1,
          currentArtifact: null,
        }));
        break;

      case "complete":
        setState((prev) => ({
          ...prev,
          status: "complete",
          currentTask: null,
          currentArtifact: null,
        }));
        if (cancelRef.current) {
          cancelRef.current = null;
        }
        break;

      case "error":
        setState((prev) => ({
          ...prev,
          status: "error",
          error: data.message || "Unknown error",
        }));
        if (cancelRef.current) {
          cancelRef.current = null;
        }
        break;

      default:
        console.warn("Unknown SSE event:", event);
    }
  }, []);

  const startAnalysis = useCallback(
    async (pipelineSlug) => {
      // Reset previous state
      if (cancelRef.current) {
        cancelRef.current();
      }

      setState({
        ...initialState,
        status: "connecting",
        pipelineSlug,
      });

      const url = `/api/pipelines/${encodeURIComponent(pipelineSlug)}/analyze`;

      const sse = fetchSSE(
        url,
        {},
        handleEvent,
        // Error handler for HTTP errors
        (errorData) => {
          setState((prev) => ({
            ...prev,
            status: "error",
            error:
              errorData.message ||
              `HTTP ${errorData.status || "error"}: ${errorData.statusText || "Unknown error"}`,
          }));
        }
      );
      cancelRef.current = sse.cancel;
    },
    [handleEvent]
  );

  return {
    ...state,
    startAnalysis,
    reset,
  };
}
