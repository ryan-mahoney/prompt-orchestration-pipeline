import React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi, afterEach } from "vitest";
import PageSubheader from "../src/components/PageSubheader.jsx";
import { Text } from "@radix-ui/themes";

describe("PageSubheader", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders breadcrumb navigation when provided", () => {
    render(
      <MemoryRouter>
        <PageSubheader
          breadcrumbs={[{ label: "Home", href: "/" }, { label: "Code" }]}
        />
      </MemoryRouter>
    );

    // Assert breadcrumb navigation
    const breadcrumbNav = screen.getByRole("navigation", {
      name: "Breadcrumb",
    });
    expect(breadcrumbNav).toBeInTheDocument();

    // Assert Home link
    const homeLink = screen.getByRole("link", { name: "Home" });
    expect(homeLink).toHaveAttribute("href", "/");

    // Assert current page crumb
    const currentCrumb = screen.getByText("Code");
    expect(currentCrumb).toBeInTheDocument();
    expect(currentCrumb).toHaveAttribute("aria-current", "page");
  });

  it("renders multiple breadcrumbs with separators", () => {
    render(
      <MemoryRouter>
        <PageSubheader
          breadcrumbs={[
            { label: "Home", href: "/" },
            { label: "Pipeline Details", href: "/pipelines" },
            { label: "Job Name" },
          ]}
        />
      </MemoryRouter>
    );

    // Assert all breadcrumb items are present (get first occurrence)
    expect(screen.getAllByRole("link", { name: "Home" })[0]).toHaveAttribute(
      "href",
      "/"
    );
    expect(
      screen.getAllByRole("link", { name: "Pipeline Details" })[0]
    ).toHaveAttribute("href", "/pipelines");
    expect(screen.getByText("Job Name")).toHaveAttribute(
      "aria-current",
      "page"
    );

    // Assert separators (ChevronRight icons) are present
    const separators = document.querySelectorAll(".lucide-chevron-right");
    expect(separators).toHaveLength(3);
  });

  it("handles empty breadcrumbs gracefully", () => {
    const { container } = render(
      <MemoryRouter>
        <PageSubheader breadcrumbs={[]} />
      </MemoryRouter>
    );

    // Breadcrumb nav should not render when empty
    expect(
      container.querySelector('nav[aria-label="Breadcrumb"]')
    ).not.toBeInTheDocument();
  });

  it("renders children on the right side", () => {
    const rightContent = <Text data-testid="right-content">Right Side</Text>;

    render(
      <MemoryRouter>
        <PageSubheader breadcrumbs={[{ label: "Home", href: "/" }]}>
          {rightContent}
        </PageSubheader>
      </MemoryRouter>
    );

    expect(screen.getByTestId("right-content")).toBeInTheDocument();
  });

  it("applies correct accessibility attributes", () => {
    render(
      <MemoryRouter>
        <PageSubheader
          breadcrumbs={[{ label: "Home", href: "/" }, { label: "Test" }]}
        />
      </MemoryRouter>
    );

    // Region landmark (get first occurrence)
    const region = screen.getAllByRole("region", { name: "Page header" })[0];
    expect(region).toBeInTheDocument();

    // Breadcrumb navigation (get first occurrence)
    const nav = screen.getAllByRole("navigation", { name: "Breadcrumb" })[0];
    expect(nav).toBeInTheDocument();

    // List structure (get first occurrence)
    const list = screen.getAllByRole("list")[0];
    expect(list).toBeInTheDocument();

    // Current page indicator
    const current = screen.getByText("Test");
    expect(current).toHaveAttribute("aria-current", "page");
  });

  it("uses custom maxWidth when provided", () => {
    const { container } = render(
      <MemoryRouter>
        <PageSubheader
          breadcrumbs={[{ label: "Home", href: "/" }, { label: "Test" }]}
          maxWidth="max-w-5xl"
        />
      </MemoryRouter>
    );

    const flexContainer = container.querySelector(".max-w-5xl");
    expect(flexContainer).toBeInTheDocument();
  });

  it("handles breadcrumbs without href (non-link items)", () => {
    render(
      <MemoryRouter>
        <PageSubheader
          breadcrumbs={[
            { label: "Home", href: "/" },
            { label: "Section" },
            { label: "Page" },
          ]}
        />
      </MemoryRouter>
    );

    // Home should be a link (get first occurrence)
    expect(
      screen.getAllByRole("link", { name: "Home" })[0]
    ).toBeInTheDocument();

    // Section and Page should be spans
    const breadcrumbSpans = document.querySelectorAll("ol span");
    const section = Array.from(breadcrumbSpans).find(
      (span) => span.textContent === "Section"
    );
    const page = Array.from(breadcrumbSpans).find(
      (span) => span.textContent === "Page"
    );

    expect(section?.tagName).toBe("SPAN");
    expect(page?.tagName).toBe("SPAN");
    expect(page).toHaveAttribute("aria-current", "page");
  });
});
