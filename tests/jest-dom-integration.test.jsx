import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

// Simple test component
const TestComponent = () => (
  <div>
    <button data-testid="test-button">Click me</button>
    <p className="test-text">Hello world</p>
    <input type="text" placeholder="Enter text" />
  </div>
);

describe("jest-dom matchers integration", () => {
  it("should have jest-dom matchers available", () => {
    // This test verifies that jest-dom matchers are properly registered
    // If jest-dom is not set up correctly, these matchers would throw "TypeError: ... is not a function"

    render(<TestComponent />);

    const button = screen.getByTestId("test-button");
    const text = screen.getByText("Hello world");
    const input = screen.getByPlaceholderText("Enter text");

    // Test various jest-dom matchers
    expect(button).toBeInTheDocument();
    expect(button).toBeVisible();
    expect(button).toHaveTextContent("Click me");
    expect(button).toHaveAttribute("data-testid", "test-button");

    expect(text).toBeInTheDocument();
    expect(text).toHaveClass("test-text");
    expect(text).toBeVisible();

    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute("type", "text");
    expect(input).toHaveAttribute("placeholder", "Enter text");
  });
});
