import "./test-dom";

import { render } from "@testing-library/react";
import { afterEach, expect, test } from "bun:test";

import { MarkdownRenderer } from "../MarkdownRenderer";

afterEach(() => {
  document.body.innerHTML = "";
});

test("MarkdownRenderer renders headings, tables, and copy button", () => {
  const view = render(
    <MarkdownRenderer
      content={[
        "# Hello World",
        "",
        "| A | B |",
        "| - | - |",
        "| 1 | 2 |",
        "",
        "```ts",
        "const a = 1;",
        "```",
      ].join("\n")}
    />,
  );

  expect(view.container.querySelector("h1")?.id).toBe("hello-world");
  expect(view.container.querySelector("table")).toBeTruthy();
  expect(view.getByRole("button", { name: "Copy code" })).toBeTruthy();
});
