import "../../components/__tests__/test-dom";

import { render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import PipelineDetail from "../PipelineDetail";
import PipelineList from "../PipelineList";
import PipelineTypeDetail from "../PipelineTypeDetail";
import PromptPipelineDashboard from "../PromptPipelineDashboard";

const originalFetch = globalThis.fetch;

vi.mock("../../client/hooks/useJobListWithUpdates", () => ({
  useJobListWithUpdates: () => ({
    loading: false,
    data: [
      {
        id: "job-1",
        jobId: "job-1",
        name: "Job 1",
        status: "running",
        progress: 50,
        taskCount: 2,
        doneCount: 1,
        location: "current",
        tasks: {},
        displayCategory: "current",
      },
    ],
    error: null,
    refetch: vi.fn(),
    connectionStatus: "connected",
  }),
}));

vi.mock("../../client/hooks/useJobDetailWithUpdates", () => ({
  useJobDetailWithUpdates: () => ({
    data: {
      id: "job-1",
      jobId: "job-1",
      name: "Job 1",
      status: "running",
      progress: 50,
      taskCount: 1,
      doneCount: 0,
      location: "current",
      tasks: {
        build: {
          name: "build",
          state: "running",
          startedAt: "2024-01-01T00:00:00.000Z",
          endedAt: null,
          files: { artifacts: [], logs: [], tmp: [] },
          attempts: 1,
          currentStage: "compile",
        },
      },
      pipelineLabel: "Demo Pipeline",
      costsSummary: {
        totalTokens: 10,
        totalInputTokens: 5,
        totalOutputTokens: 5,
        totalCost: 1,
        totalInputCost: 0.5,
        totalOutputCost: 0.5,
      },
    },
    loading: false,
    error: null,
    connectionStatus: "connected",
    isRefreshing: false,
    isTransitioning: false,
    isHydrated: true,
  }),
}));

vi.mock("../../client/hooks/useAnalysisProgress", () => ({
  useAnalysisProgress: () => ({
    status: "idle",
    pipelineSlug: null,
    totalTasks: 0,
    completedTasks: 0,
    totalArtifacts: 0,
    completedArtifacts: 0,
    currentTask: null,
    currentArtifact: null,
    error: null,
    startAnalysis: vi.fn(),
    reset: vi.fn(),
  }),
}));

describe("pages", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof Request
            ? input.url
            : input.toString();
      if (url.endsWith("/api/pipelines")) {
        return new Response(JSON.stringify({ ok: true, data: [{ slug: "demo", name: "Demo", description: "Demo pipeline" }] }));
      }
      if (url.endsWith("/api/pipelines/demo")) {
        return new Response(JSON.stringify({ ok: true, data: { slug: "demo", name: "Demo", description: "Demo pipeline", tasks: [{ id: "task-1", title: "Task 1", status: "definition" }] } }));
      }
      return new Response(JSON.stringify({ ok: true }));
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it("renders the dashboard", () => {
    const dashboard = render(
      <MemoryRouter initialEntries={["/"]}>
        <PromptPipelineDashboard />
      </MemoryRouter>,
    );
    expect(dashboard.getByText("Job 1")).not.toBeNull();
    dashboard.unmount();
  });

  it("renders the pipeline list", async () => {
    const list = render(
      <MemoryRouter initialEntries={["/pipelines"]}>
        <PipelineList />
      </MemoryRouter>,
    );
    await waitFor(() => expect(list.getAllByText("Demo")[0]).not.toBeNull());
    list.unmount();
  });

  it("renders the pipeline type detail", async () => {
    const typeDetail = render(
      <MemoryRouter initialEntries={["/pipelines/demo"]}>
        <Routes>
          <Route path="/pipelines/:slug" element={<PipelineTypeDetail />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(typeDetail.getAllByText("Demo")[0]).not.toBeNull());
    typeDetail.unmount();
  });

  it("renders the pipeline detail", () => {
    const detail = render(
      <MemoryRouter initialEntries={["/pipeline/job-1"]}>
        <Routes>
          <Route path="/pipeline/:jobId" element={<PipelineDetail />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(detail.getAllByText("Job 1")[0]).not.toBeNull();
    detail.unmount();
  });
});
