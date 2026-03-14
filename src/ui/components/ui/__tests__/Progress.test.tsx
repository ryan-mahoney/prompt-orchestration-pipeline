import { expect, test } from "bun:test";

import { Progress } from "../Progress";

test("Progress clamps high values to 100", () => {
  const element = Progress({ value: 150 });
  expect(element.props.children.props.style.width).toBe("100%");
});

test("Progress clamps low values to 0", () => {
  const element = Progress({ value: -10 });
  expect(element.props.children.props.style.width).toBe("0%");
});

test("Progress applies variant color classes", () => {
  expect(Progress({ variant: "default" }).props.children.props.className).toContain("bg-brand-600");
  expect(Progress({ variant: "error" }).props.children.props.className).toContain("bg-red-600");
  expect(Progress({ variant: "completed" }).props.children.props.className).toContain("bg-brand-600");
  expect(Progress({ variant: "pending" }).props.children.props.className).toContain("bg-gray-400");
});
