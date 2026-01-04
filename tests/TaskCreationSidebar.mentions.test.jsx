import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Create a more sophisticated mock that simulates autocomplete behavior
const mockMentionsInputState = { suggestions: [], showSuggestions: false };

vi.mock("react-mentions", () => ({
  MentionsInput: ({ children, value, onChange, ...props }) => {
    // Extract Mention child to get data
    const mentionChild = children;
    const mentionData = mentionChild?.props?.data || [];

    const handleInput = (e) => {
      const newValue = e.target.value;
      onChange(e, newValue);

      // Simulate autocomplete trigger when @ is typed
      if (newValue.includes("@")) {
        const atIndex = newValue.lastIndexOf("@");
        const query = newValue.slice(atIndex + 1);
        mockMentionsInputState.suggestions = mentionData.filter((item) =>
          item.display.toLowerCase().includes(query.toLowerCase())
        );
        mockMentionsInputState.showSuggestions = true;
      } else {
        mockMentionsInputState.showSuggestions = false;
        mockMentionsInputState.suggestions = [];
      }
    };

    const selectSuggestion = (suggestion) => {
      // Simulate mention insertion in react-mentions format
      const mentionMarkup = `@[${suggestion.display}](${suggestion.id})`;
      const atIndex = value.lastIndexOf("@");
      const newValue =
        value.slice(0, atIndex) +
        mentionMarkup +
        " " +
        value.slice(atIndex + 1);
      onChange({ target: { value: newValue } }, newValue);
      mockMentionsInputState.showSuggestions = false;
      mockMentionsInputState.suggestions = [];
    };

    return (
      <div data-testid="mentions-input-wrapper">
        <textarea
          value={value}
          onChange={handleInput}
          aria-label={props["aria-label"]}
          disabled={props.disabled}
          placeholder={props.placeholder}
          data-testid="mentions-input"
        />
        {mockMentionsInputState.showSuggestions &&
          mockMentionsInputState.suggestions.length > 0 && (
            <ul data-testid="suggestions-dropdown" role="listbox">
              {mockMentionsInputState.suggestions.map((suggestion) => (
                <li
                  key={suggestion.id}
                  role="option"
                  onClick={() => selectSuggestion(suggestion)}
                  data-testid={`suggestion-${suggestion.id}`}
                >
                  {suggestion.display}
                </li>
              ))}
            </ul>
          )}
      </div>
    );
  },
  Mention: ({ trigger, data, className }) => null,
}));

import TaskCreationSidebar from "../src/components/TaskCreationSidebar.jsx";

describe("TaskCreationSidebar - Mentions Autocomplete", () => {
  const mockArtifacts = [
    {
      fileName: "output.json",
      sources: [{ taskName: "task-1", stage: "output" }],
    },
    {
      fileName: "report.md",
      sources: [{ taskName: "task-2", stage: "output" }],
    },
    {
      fileName: "analysis.csv",
      sources: [{ taskName: "task-3", stage: "output" }],
    },
  ];

  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    pipelineSlug: "test-pipeline",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
    // Reset mock state
    mockMentionsInputState.suggestions = [];
    mockMentionsInputState.showSuggestions = false;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("shows suggestion dropdown when @ is typed", async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ artifacts: mockArtifacts }),
    });

    render(<TaskCreationSidebar {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Files (3)")).toBeInTheDocument();
    });

    const input = screen.getByLabelText("Task description input");
    fireEvent.change(input, { target: { value: "@" } });

    expect(screen.getByTestId("suggestions-dropdown")).toBeInTheDocument();
    expect(screen.getByText("output.json")).toBeInTheDocument();
    expect(screen.getByText("report.md")).toBeInTheDocument();
    expect(screen.getByText("analysis.csv")).toBeInTheDocument();
  });

  it("filters suggestions based on typed characters after @", async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ artifacts: mockArtifacts }),
    });

    render(<TaskCreationSidebar {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Files (3)")).toBeInTheDocument();
    });

    const input = screen.getByLabelText("Task description input");
    fireEvent.change(input, { target: { value: "@out" } });

    expect(screen.getByTestId("suggestions-dropdown")).toBeInTheDocument();
    expect(screen.getByText("output.json")).toBeInTheDocument();
    expect(screen.queryByText("report.md")).not.toBeInTheDocument();
    expect(screen.queryByText("analysis.csv")).not.toBeInTheDocument();
  });

  it("filters suggestions case-insensitively", async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ artifacts: mockArtifacts }),
    });

    render(<TaskCreationSidebar {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Files (3)")).toBeInTheDocument();
    });

    const input = screen.getByLabelText("Task description input");
    fireEvent.change(input, { target: { value: "@REPORT" } });

    expect(screen.getByTestId("suggestions-dropdown")).toBeInTheDocument();
    expect(screen.getByText("report.md")).toBeInTheDocument();
    expect(screen.queryByText("output.json")).not.toBeInTheDocument();
  });

  it("inserts mention markup when suggestion is clicked", async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ artifacts: mockArtifacts }),
    });

    render(<TaskCreationSidebar {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Files (3)")).toBeInTheDocument();
    });

    const input = screen.getByLabelText("Task description input");
    fireEvent.change(input, { target: { value: "@" } });

    expect(screen.getByTestId("suggestions-dropdown")).toBeInTheDocument();

    // Click on a suggestion
    fireEvent.click(screen.getByTestId("suggestion-output.json"));

    // Dropdown should close and input should have mention markup
    expect(
      screen.queryByTestId("suggestions-dropdown")
    ).not.toBeInTheDocument();
    expect(input).toHaveValue("@[output.json](output.json) ");
  });

  it("hides dropdown when no suggestions match", async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ artifacts: mockArtifacts }),
    });

    render(<TaskCreationSidebar {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Files (3)")).toBeInTheDocument();
    });

    const input = screen.getByLabelText("Task description input");
    fireEvent.change(input, { target: { value: "@xyz123" } });

    // Dropdown should not appear when no matches
    expect(
      screen.queryByTestId("suggestions-dropdown")
    ).not.toBeInTheDocument();
  });

  it("shows no dropdown when artifacts are empty", async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ artifacts: [] }),
    });

    render(<TaskCreationSidebar {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Files (0)")).toBeInTheDocument();
    });

    const input = screen.getByLabelText("Task description input");
    fireEvent.change(input, { target: { value: "@" } });

    // No dropdown when no artifacts
    expect(
      screen.queryByTestId("suggestions-dropdown")
    ).not.toBeInTheDocument();
  });

  it("allows typing regular text without triggering autocomplete", async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ artifacts: mockArtifacts }),
    });

    render(<TaskCreationSidebar {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Files (3)")).toBeInTheDocument();
    });

    const input = screen.getByLabelText("Task description input");
    fireEvent.change(input, { target: { value: "Hello world" } });

    expect(
      screen.queryByTestId("suggestions-dropdown")
    ).not.toBeInTheDocument();
    expect(input).toHaveValue("Hello world");
  });
});
