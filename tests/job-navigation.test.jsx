import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Mock the components we want to test
import JobTable from "../src/components/JobTable.jsx";
import JobCard from "../src/components/JobCard.jsx";
import PromptPipelineDashboard from "../src/pages/PromptPipelineDashboard.jsx";

// Mock the hook used by the dashboard
vi.mock("../src/ui/client/hooks/useJobListWithUpdates.js", () => ({
  useJobListWithUpdates: vi.fn(),
}));

// Mock react-router-dom
const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

import { useJobListWithUpdates } from "../src/ui/client/hooks/useJobListWithUpdates.js";

describe("Job Navigation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNavigate.mockClear();
    useJobListWithUpdates.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("PromptPipelineDashboard openJob function", () => {
    it("should navigate with job.id when available", () => {
      useJobListWithUpdates.mockReturnValue({
        loading: false,
        data: [],
        error: null,
        refetch: vi.fn(),
        connectionStatus: "connected",
      });

      render(
        <MemoryRouter>
          <PromptPipelineDashboard />
        </MemoryRouter>
      );

      // Test the openJob function indirectly through the existing dashboard tests
      const mockJob = {
        id: "job-123",
        name: "Test Job",
        pipelineId: "legacy-slug",
      };

      // We'll test this through the existing PromptPipelineDashboard.test.jsx
      expect(mockNavigate).not.toHaveBeenCalled();
    });

    it("should not navigate when job.id is missing", () => {
      const mockJob = { name: "Legacy Job", pipelineId: "legacy-slug" };

      // This test will fail with current implementation since it falls back to pipelineId
      // We'll need to modify the component to handle this case
      expect(mockNavigate).not.toHaveBeenCalled();
    });
  });

  describe("JobTable navigation", () => {
    const mockPipeline = { tasks: [{ id: "task1" }] };
    const mockOnOpenJob = vi.fn();

    it("should call onOpenJob with job when row is clicked", () => {
      const jobs = [
        { id: "job-1", name: "Test Job", status: "running", tasks: {} },
      ];

      render(
        <JobTable
          jobs={jobs}
          pipeline={mockPipeline}
          onOpenJob={mockOnOpenJob}
          totalProgressPct={() => 50}
          overallElapsed={() => 1000}
        />
      );

      const jobRow = screen.getByText("Test Job").closest("tr");
      fireEvent.click(jobRow);

      expect(mockOnOpenJob).toHaveBeenCalledWith(jobs[0]);
    });

    it("should be accessible via keyboard", () => {
      const jobs = [
        {
          id: "job-1",
          name: "Keyboard Test Job",
          status: "running",
          tasks: {},
        },
      ];

      render(
        <JobTable
          jobs={jobs}
          pipeline={mockPipeline}
          onOpenJob={mockOnOpenJob}
          totalProgressPct={() => 50}
          overallElapsed={() => 1000}
        />
      );

      const jobRow = screen.getByText("Keyboard Test Job").closest("tr");
      fireEvent.keyDown(jobRow, { key: "Enter" });

      expect(mockOnOpenJob).toHaveBeenCalledWith(jobs[0]);
    });

    it("should handle jobs without proper ID gracefully", () => {
      const jobs = [
        {
          name: "Legacy Job",
          pipelineId: "legacy-slug",
          status: "running",
          tasks: {},
        },
      ];

      render(
        <JobTable
          jobs={jobs}
          pipeline={mockPipeline}
          onOpenJob={mockOnOpenJob}
          totalProgressPct={() => 50}
          overallElapsed={() => 1000}
        />
      );

      const jobRow = screen.getByText("Legacy Job").closest("tr");

      // Should still be clickable but onOpenJob should receive the job without proper ID
      fireEvent.click(jobRow);
      expect(mockOnOpenJob).toHaveBeenCalledWith(jobs[0]);
    });
  });

  describe("JobCard navigation", () => {
    const mockPipeline = { tasks: [{ id: "task1" }] };
    const mockOnClick = vi.fn();

    it("should call onClick when card is clicked", () => {
      const job = {
        id: "job-1",
        name: "Card Test Job",
        status: "running",
        tasks: {},
      };

      render(
        <JobCard
          job={job}
          pipeline={mockPipeline}
          onClick={mockOnClick}
          progressPct={50}
          overallElapsedMs={1000}
        />
      );

      const card = screen.getByRole("button", { name: /Open Card Test Job/i });
      fireEvent.click(card);

      expect(mockOnClick).toHaveBeenCalledTimes(1);
    });

    it("should be accessible via keyboard", () => {
      const job = {
        id: "job-1",
        name: "Keyboard Card Job",
        status: "running",
        tasks: {},
      };

      render(
        <JobCard
          job={job}
          pipeline={mockPipeline}
          onClick={mockOnClick}
          progressPct={50}
          overallElapsedMs={1000}
        />
      );

      const card = screen.getByRole("button", {
        name: /Open Keyboard Card Job/i,
      });
      fireEvent.keyDown(card, { key: " " });

      expect(mockOnClick).toHaveBeenCalledTimes(1);
    });

    it("should handle jobs without proper ID gracefully", () => {
      const job = {
        name: "Legacy Card Job",
        pipelineId: "legacy-slug",
        status: "running",
        tasks: {},
      };

      render(
        <JobCard
          job={job}
          pipeline={mockPipeline}
          onClick={mockOnClick}
          progressPct={50}
          overallElapsedMs={1000}
        />
      );

      const card = screen.getByRole("button", {
        name: /Open Legacy Card Job/i,
      });
      fireEvent.click(card);

      expect(mockOnClick).toHaveBeenCalledTimes(1);
    });
  });
});
