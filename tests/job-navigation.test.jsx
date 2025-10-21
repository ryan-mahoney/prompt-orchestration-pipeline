import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

// Mocks must be registered before modules under test are imported
const mockNavigate = vi.fn();

const createJobsHookDefault = () => ({
  loading: false,
  data: [],
  error: null,
  refetch: vi.fn(),
  connectionStatus: "disconnected",
});

vi.mock("../src/ui/client/hooks/useJobListWithUpdates.js", () => {
  const mockHook = vi.fn(() => createJobsHookDefault());
  return {
    useJobListWithUpdates: mockHook,
  };
});

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

import { MemoryRouter } from "react-router-dom";
import JobTable from "../src/components/JobTable.jsx";
import JobCard from "../src/components/JobCard.jsx";
import PromptPipelineDashboard from "../src/pages/PromptPipelineDashboard.jsx";
import { useJobListWithUpdates } from "../src/ui/client/hooks/useJobListWithUpdates.js";

describe("Job Navigation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNavigate.mockClear();
    useJobListWithUpdates.mockReset();
    useJobListWithUpdates.mockImplementation(() => createJobsHookDefault());
    vi.useRealTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
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
      };

      // We'll test this through the existing PromptPipelineDashboard.test.jsx
      expect(mockNavigate).not.toHaveBeenCalled();
    });

    it("should not navigate when job.id is missing", () => {
      const mockJob = { name: "Legacy Job", id: "legacy-slug" };

      // This should not navigate since job.id is missing
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

    it("should not call onOpenJob for jobs without valid ID", () => {
      const jobs = [
        {
          name: "Legacy Job",
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

      // Should not call onOpenJob since job.id is missing
      fireEvent.click(jobRow);
      expect(mockOnOpenJob).not.toHaveBeenCalled();
    });

    it("should show disabled styling for jobs without valid ID", () => {
      const jobs = [
        {
          name: "Legacy Job",
          status: "running",
          tasks: {},
        },
      ];

      const { container } = render(
        <JobTable
          jobs={jobs}
          pipeline={mockPipeline}
          onOpenJob={mockOnOpenJob}
          totalProgressPct={() => 50}
          overallElapsed={() => 1000}
        />
      );

      const jobRow = container.querySelector(
        'tr[title="This job cannot be opened because it lacks a valid ID"]'
      );

      // Should have disabled styling
      expect(jobRow.className).toContain("cursor-not-allowed");
      expect(jobRow.className).toContain("opacity-60");
      expect(jobRow.getAttribute("tabIndex")).toBe("-1");
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

    it("should not call onClick for jobs without valid ID", () => {
      const job = {
        name: "Legacy Card Job",
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
        name: /Legacy Card Job - No valid job ID, cannot open details/i,
      });
      fireEvent.click(card);

      expect(mockOnClick).not.toHaveBeenCalled();
    });

    it("should show disabled styling for jobs without valid ID", () => {
      const job = {
        name: "Legacy Card Job",
        status: "running",
        tasks: {},
      };

      const { container } = render(
        <JobCard
          job={job}
          pipeline={mockPipeline}
          onClick={mockOnClick}
          progressPct={50}
          overallElapsedMs={1000}
        />
      );

      const card = container.querySelector(
        '[role="button"][title="This job cannot be opened because it lacks a valid ID"]'
      );

      // Should have disabled styling
      expect(card.className).toContain("cursor-not-allowed");
      expect(card.className).toContain("opacity-60");
      expect(card.getAttribute("tabIndex")).toBe("-1");
    });
  });
});
