import { expect, test } from "bun:test";

import { Button } from "../Button";

test("Button defaults type to button", () => {
  expect(Button({ children: "Save" }).props.type).toBe("button");
});

test("Button renders loading spinner content", () => {
  const element = Button({ children: "Save", loading: true });
  expect(element.props.disabled).toBe(true);
  expect(element.props.children.props.children[0].props.className).toContain("animate-spin");
});

test("Button applies variant classes", () => {
  expect(Button({ children: "A", variant: "solid" }).props.className).toContain("bg-[hsl(var(--primary))]");
  expect(Button({ children: "A", variant: "soft" }).props.className).toContain("bg-[hsl(var(--primary))]/10");
  expect(Button({ children: "A", variant: "outline" }).props.className).toContain("border-[hsl(var(--border))]");
  expect(Button({ children: "A", variant: "ghost" }).props.className).toContain("bg-transparent");
  expect(Button({ children: "A", variant: "destructive" }).props.className).toContain("bg-[hsl(var(--destructive))]");
});
