import { expect, test } from "bun:test";

import { Logo } from "../Logo";
import { Badge } from "../Badge";
import { Separator } from "../Separator";

test("Badge applies intent classes", () => {
  expect(Badge({ intent: "gray", children: "Gray" }).props.className).toContain("bg-gray-100");
  expect(Badge({ intent: "blue", children: "Blue" }).props.className).toContain("bg-blue-100");
  expect(Badge({ intent: "green", children: "Green" }).props.className).toContain("bg-green-100");
  expect(Badge({ intent: "red", children: "Red" }).props.className).toContain("bg-red-100");
  expect(Badge({ intent: "amber", children: "Amber" }).props.className).toContain("bg-yellow-100");
});

test("Separator renders an hr", () => {
  expect(Separator({}).type).toBe("hr");
});

test("Logo renders an svg", () => {
  expect(Logo().type).toBe("svg");
});
