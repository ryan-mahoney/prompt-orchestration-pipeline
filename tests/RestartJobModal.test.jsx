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
      screen.getByText("Restart from test-task-456")
    ).toBeInTheDocument();
    expect(
      screen.getByText(/This will restart the job from the/)
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

  it("calls onClose when close button is clicked", () => {
    render(<RestartJobModal {...defaultProps} />);

    const closeButton = screen.getByLabelText("Close");
    fireEvent.click(closeButton);

    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onConfirm when Re-run this task button is clicked", () => {
    render(<RestartJobModal {...defaultProps} />);

    const restartButton = screen.getByText("Re-run this task");
    fireEvent.click(restartButton);

    expect(defaultProps.onConfirm).toHaveBeenCalledWith({ singleTask: true });
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

    const restartEntireButton = screen.getByText("Restarting...");
    const rerunButtons = screen.getAllByText("Running...");

    expect(restartEntireButton).toBeDisabled();
    expect(restartEntireButton).toHaveTextContent("Restarting...");
    expect(rerunButtons).toHaveLength(2);
    rerunButtons.forEach(button => {
      expect(button).toBeDisabled();
    });
  });

  it("closes modal when Escape key is pressed", () => {
    render(<RestartJobModal {...defaultProps} />);

    fireEvent.keyDown(document, { key: "Escape" });

    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });

  it("confirms when Enter key is pressed (without taskId)", () => {
    const propsWithoutTaskId = { ...defaultProps, taskId: null };
    render(<RestartJobModal {...propsWithoutTaskId} />);

    const dialog = screen.getByRole("dialog");
    fireEvent.keyDown(dialog, { key: "Enter" });

    expect(defaultProps.onConfirm).toHaveBeenCalledWith({ singleTask: false });
  });

  it("does not confirm when Enter key is pressed during submission", () => {
    render(<RestartJobModal {...defaultProps} isSubmitting={true} />);

    const dialog = screen.getByRole("dialog");
    fireEvent.keyDown(dialog, { key: "Enter" });

    expect(defaultProps.onConfirm).not.toHaveBeenCalled();
  });

  it("has proper accessibility attributes", () => {
    render(<RestartJobModal {...defaultProps} />);

    const dialog = screen.getAllByRole("dialog")[0];
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-labelledby", "restart-modal-title");
    expect(dialog).toHaveAttribute(
      "aria-describedby",
      "restart-modal-description"
    );

    const title = screen.getByRole("heading", {
      name: "Restart from test-task-456",
    });
    expect(title).toHaveAttribute("id", "restart-modal-title");

    const description = screen.getByText(
      /This will restart the job from the/
    ).parentElement;
    expect(description).toHaveAttribute("id", "restart-modal-description");
  });

  it("renders three buttons when taskId is provided", () => {
    render(<RestartJobModal {...defaultProps} />);

    const restartEntireButton = screen.getByText("Restart entire pipeline");
    const rerunContinueButton = screen.getByText("Re-run task and continue pipeline");
    const rerunTaskButton = screen.getByText("Re-run this task");

    expect(restartEntireButton).toBeInTheDocument();
    expect(rerunContinueButton).toBeInTheDocument();
    expect(rerunTaskButton).toBeInTheDocument();
  });

  it("calls onConfirm with continueAfter flag when middle button is clicked", () => {
    render(<RestartJobModal {...defaultProps} />);

    const rerunContinueButton = screen.getByText("Re-run task and continue pipeline");
    fireEvent.click(rerunContinueButton);

    expect(defaultProps.onConfirm).toHaveBeenCalledWith({
      singleTask: true,
      continueAfter: true,
    });
  });
});
