import { useCallback, useRef, useState } from "react";

import { fetchSSE } from "../sse-fetch";
import type {
  AnalysisProgressState,
  AnalysisSseEventType,
  SseFetchHandle,
  UseAnalysisProgressResult,
} from "../types";

export function createInitialAnalysisState(): AnalysisProgressState {
  return {
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
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function reduceAnalysisEvent(
  state: AnalysisProgressState,
  eventType: AnalysisSseEventType,
  payload: unknown,
): AnalysisProgressState {
  const data = isRecord(payload) ? payload : {};

  if (eventType === "started") {
    return {
      ...state,
      status: "running",
      totalTasks: typeof data["totalTasks"] === "number" ? data["totalTasks"] : state.totalTasks,
      totalArtifacts: typeof data["totalArtifacts"] === "number" ? data["totalArtifacts"] : state.totalArtifacts,
    };
  }
  if (eventType === "task:start") {
    return { ...state, currentTask: typeof data["task"] === "string" ? data["task"] : state.currentTask };
  }
  if (eventType === "artifact:start") {
    return { ...state, currentArtifact: typeof data["artifact"] === "string" ? data["artifact"] : state.currentArtifact };
  }
  if (eventType === "artifact:complete") {
    return { ...state, completedArtifacts: state.completedArtifacts + 1, currentArtifact: null };
  }
  if (eventType === "task:complete") {
    return { ...state, completedTasks: state.completedTasks + 1, currentTask: null };
  }
  if (eventType === "complete") {
    return { ...state, status: "complete", currentTask: null, currentArtifact: null };
  }
  if (eventType === "error") {
    return {
      ...state,
      status: "error",
      error: typeof data["message"] === "string" ? data["message"] : "Analysis failed",
    };
  }
  return state;
}

export function useAnalysisProgress(): UseAnalysisProgressResult {
  const [state, setState] = useState(createInitialAnalysisState);
  const cancelRef = useRef<SseFetchHandle | null>(null);

  const reset = useCallback(() => {
    cancelRef.current?.cancel();
    cancelRef.current = null;
    setState(createInitialAnalysisState());
  }, []);

  const startAnalysis = useCallback((pipelineSlug: string) => {
    cancelRef.current?.cancel();
    setState({
      ...createInitialAnalysisState(),
      status: "connecting",
      pipelineSlug,
    });

    cancelRef.current = fetchSSE(
      `/api/pipelines/${pipelineSlug}/analyze`,
      { method: "POST" },
      (eventName, payload) => {
        setState((current) => reduceAnalysisEvent(current, eventName as AnalysisSseEventType, payload));
      },
      (error) => {
        setState((current) => ({
          ...current,
          status: "error",
          error: error instanceof Error ? error.message : "Analysis failed",
        }));
      },
    );
  }, []);

  return {
    ...state,
    startAnalysis,
    reset,
  };
}
