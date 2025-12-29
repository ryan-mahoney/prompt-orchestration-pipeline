import { render, screen, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { SchemaPreviewPanel } from "../src/components/SchemaPreviewPanel.jsx";

vi.mock("lucide-react", () => ({
  X: ({ className }) => <span data-testid="x-icon" className={className} />,
  Copy: ({ className }) => (
    <span data-testid="copy-icon" className={className} />
  ),
  Check: ({ className }) => (
    <span data-testid="check-icon" className={className} />
  ),
}));

vi.mock("react-syntax-highlighter", () => ({
  Prism: ({ children, language, style, customStyle }) => (
    <pre
      data-testid="syntax-highlighter"
      data-language={language}
      data-style={JSON.stringify(style)}
      data-custom-style={JSON.stringify(customStyle)}
    >
      {children}
    </pre>
  ),
}));

vi.mock("react-syntax-highlighter/dist/esm/styles/prism", () => ({
  oneLight: { base: "oneLight" },
}));

describe("SchemaPreviewPanel", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders file name and type in header", () => {
    const onClose = vi.fn();
    render(
      <SchemaPreviewPanel
        fileName="test.json"
        type="schema"
        content={null}
        loading={false}
        error={null}
        onClose={onClose}
      />
    );

    expect(screen.getByText("test.json (schema)")).toBeInTheDocument();
  });

  it("renders loading state when loading=true", () => {
    const onClose = vi.fn();
    render(
      <SchemaPreviewPanel
        fileName="test.json"
        type="schema"
        content={null}
        loading={true}
        error={null}
        onClose={onClose}
      />
    );

    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  it("renders error message when error is set", () => {
    const onClose = vi.fn();
    render(
      <SchemaPreviewPanel
        fileName="test.json"
        type="schema"
        content={null}
        loading={false}
        error="Failed to load schema"
        onClose={onClose}
      />
    );

    expect(screen.getByText("Failed to load schema")).toBeInTheDocument();
  });

  it("renders syntax-highlighted JSON when content is provided", () => {
    const onClose = vi.fn();
    const content = JSON.stringify({ type: "object" });

    render(
      <SchemaPreviewPanel
        fileName="test.json"
        type="schema"
        content={content}
        loading={false}
        error={null}
        onClose={onClose}
      />
    );

    const highlighter = screen.getByTestId("syntax-highlighter");
    expect(highlighter).toBeInTheDocument();
    expect(highlighter).toHaveAttribute("data-language", "json");
    expect(highlighter).toHaveTextContent(content);
  });

  it("calls onClose when X button clicked", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();

    render(
      <SchemaPreviewPanel
        fileName="test.json"
        type="schema"
        content={null}
        loading={false}
        error={null}
        onClose={onClose}
      />
    );

    const closeButton = screen.getByRole("button", { name: "Close preview" });
    await user.click(closeButton);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when Escape key pressed", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();

    render(
      <SchemaPreviewPanel
        fileName="test.json"
        type="schema"
        content={null}
        loading={false}
        error={null}
        onClose={onClose}
      />
    );

    const panel = screen.getByText("test.json (schema)").closest("div");
    panel.focus();
    await user.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("has correct ARIA label on close button", () => {
    const onClose = vi.fn();

    render(
      <SchemaPreviewPanel
        fileName="test.json"
        type="schema"
        content={null}
        loading={false}
        error={null}
        onClose={onClose}
      />
    );

    const closeButton = screen.getByRole("button", { name: "Close preview" });
    expect(closeButton).toHaveAttribute("aria-label", "Close preview");
  });

  it("renders sample type in header", () => {
    const onClose = vi.fn();

    render(
      <SchemaPreviewPanel
        fileName="data.json"
        type="sample"
        content={null}
        loading={false}
        error={null}
        onClose={onClose}
      />
    );

    expect(screen.getByText("data.json (sample)")).toBeInTheDocument();
  });

  it("does not render content when loading", () => {
    const onClose = vi.fn();
    const content = JSON.stringify({ type: "object" });

    render(
      <SchemaPreviewPanel
        fileName="test.json"
        type="schema"
        content={content}
        loading={true}
        error={null}
        onClose={onClose}
      />
    );

    expect(screen.getByText("Loading...")).toBeInTheDocument();
    expect(screen.queryByTestId("syntax-highlighter")).not.toBeInTheDocument();
  });

  it("does not render content when error is present", () => {
    const onClose = vi.fn();
    const content = JSON.stringify({ type: "object" });

    render(
      <SchemaPreviewPanel
        fileName="test.json"
        type="schema"
        content={content}
        loading={false}
        error="Network error"
        onClose={onClose}
      />
    );

    expect(screen.getByText("Network error")).toBeInTheDocument();
    expect(screen.queryByTestId("syntax-highlighter")).not.toBeInTheDocument();
  });
});
