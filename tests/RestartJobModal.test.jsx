import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import RestartJobModal from "../src/components/ui/RestartJobModal.jsx";

describe("RestartJobModal", () => {
  const defaultProps = {
    open: true,
    onClose: vi.fn(),
    onConfirm: vi.fn(),
    jobId: "test-job-123",
    taskId: "test-task-456",
    isSubmitting: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders when open is true", () => {
    render(<RestartJobModal {...defaultProps} />);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(
      screen.getByText("Restart job from clean slate")
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Restarting from this task will reset/)
    ).toBeInTheDocument();
  });

  it("does not render when open is false", () => {
    render(<RestartJobModal {...defaultProps} open={false} />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("displays task ID when provided", () => {
    render(<RestartJobModal {...defaultProps} />);

    expect(screen.getByText("test-task-456")).toBeInTheDocument();
    expect(screen.getByText(/Triggered from task:/)).toBeInTheDocument();
  });

  it("hides task ID when not provided", () => {
    const propsWithoutTaskId = { ...defaultProps, taskId: null };
    render(<RestartJobModal {...propsWithoutTaskId} />);

    expect(screen.queryByText(/Triggered from task:/)).not.toBeInTheDocument();
  });

  it("calls onClose when Cancel button is clicked", () => {
    render(<RestartJobModal {...defaultProps} />);

    const cancelButton = screen.getByText("Cancel");
    fireEvent.click(cancelButton);

    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onConfirm when Restart button is clicked", () => {
    render(<RestartJobModal {...defaultProps} />);

    const restartButton = screen.getByText("Restart");
    fireEvent.click(restartButton);

    expect(defaultProps.onConfirm).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when backdrop is clicked", () => {
    render(<RestartJobModal {...defaultProps} />);

    // Find the backdrop - it's the first div with aria-hidden="true" inside the modal container
    const backdrop = screen
      .getByRole("dialog")
      .parentElement.querySelector('[aria-hidden="true"]');
    fireEvent.click(backdrop);

    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });

  it("disables buttons and shows loading state when isSubmitting is true", () => {
    render(<RestartJobModal {...defaultProps} isSubmitting={true} />);

    const cancelButton = screen.getByText("Cancel");
    const restartButton = screen.getByText("Restarting...");

    expect(cancelButton).toBeDisabled();
    expect(restartButton).toBeDisabled();
    expect(restartButton).toHaveTextContent("Restarting...");
  });

  it("closes modal when Escape key is pressed", () => {
    render(<RestartJobModal {...defaultProps} />);

    fireEvent.keyDown(document, { key: "Escape" });

    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });

  it("confirms when Enter key is pressed", () => {
    render(<RestartJobModal {...defaultProps} />);

    const dialog = screen.getByRole("dialog");
    fireEvent.keyDown(dialog, { key: "Enter" });

    expect(defaultProps.onConfirm).toHaveBeenCalledTimes(1);
  });

  it("does not confirm when Enter key is pressed during submission", () => {
    render(<RestartJobModal {...defaultProps} isSubmitting={true} />);

    const dialog = screen.getByRole("dialog");
    fireEvent.keyDown(dialog, { key: "Enter" });

    expect(defaultProps.onConfirm).not.toHaveBeenCalled();
  });

  it("has proper accessibility attributes", () => {
    render(<RestartJobModal {...defaultProps} />);

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-labelledby", "restart-modal-title");
    expect(dialog).toHaveAttribute(
      "aria-describedby",
      "restart-modal-description"
    );

    const title = screen.getByRole("heading", {
      name: "Restart job from clean slate",
    });
    expect(title).toHaveAttribute("id", "restart-modal-title");

    const description = screen.getByText(
      /Restarting from this task will reset/
    ).parentElement;
    expect(description).toHaveAttribute("id", "restart-modal-description");
  });
});
