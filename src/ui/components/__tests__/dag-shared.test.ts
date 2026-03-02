import "./test-dom";

import { afterEach, expect, test } from "bun:test";

import {
  checkReducedMotion,
  computeConnectorLines,
  computeEffectiveCols,
  computeVisualOrder,
  formatStepName,
  upperFirst,
} from "../dag-shared";

afterEach(() => {
  document.body.innerHTML = "";
});

test("upperFirst capitalizes the first character", () => {
  expect(upperFirst("hello")).toBe("Hello");
});

test("formatStepName converts delimiters to title case", () => {
  expect(formatStepName("my-task-name")).toBe("My Task Name");
});

test("computeVisualOrder creates boustrophedon padding", () => {
  expect(computeVisualOrder(7, 3)).toEqual([0, 1, 2, 5, 4, 3, 6, -1, -1]);
});

test("computeEffectiveCols collapses below breakpoint", () => {
  expect(computeEffectiveCols(800)).toBe(1);
  expect(computeEffectiveCols(1200)).toBe(3);
});

test("checkReducedMotion reflects matchMedia", () => {
  window.matchMedia = ((query: string) =>
    ({
      matches: query === "(prefers-reduced-motion: reduce)",
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return false;
      },
    }) as MediaQueryList) as typeof window.matchMedia;

  expect(checkReducedMotion()).toBe(true);
});

test("computeConnectorLines routes horizontal segments through card headers", () => {
  const overlay = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const first = document.createElement("div");
  const firstHeader = document.createElement("div");
  const second = document.createElement("div");
  const secondHeader = document.createElement("div");

  first.querySelector = ((selector: string) =>
    selector === '[data-role="card-header"]' ? firstHeader : null) as typeof first.querySelector;
  second.querySelector = ((selector: string) =>
    selector === '[data-role="card-header"]' ? secondHeader : null) as typeof second.querySelector;

  overlay.getBoundingClientRect = () =>
    ({ left: 0, top: 0, right: 400, bottom: 200, width: 400, height: 200, x: 0, y: 0, toJSON() {} }) as DOMRect;
  first.getBoundingClientRect = () =>
    ({ left: 20, top: 40, right: 120, bottom: 140, width: 100, height: 100, x: 20, y: 40, toJSON() {} }) as DOMRect;
  firstHeader.getBoundingClientRect = () =>
    ({ left: 20, top: 40, right: 120, bottom: 64, width: 100, height: 24, x: 20, y: 40, toJSON() {} }) as DOMRect;
  second.getBoundingClientRect = () =>
    ({ left: 180, top: 50, right: 280, bottom: 150, width: 100, height: 100, x: 180, y: 50, toJSON() {} }) as DOMRect;
  secondHeader.getBoundingClientRect = () =>
    ({ left: 180, top: 50, right: 280, bottom: 74, width: 100, height: 24, x: 180, y: 50, toJSON() {} }) as DOMRect;

  const lines = computeConnectorLines(new Map([
    [0, first],
    [1, second],
  ]), overlay, 2, 2);

  expect(lines).toEqual([
    { d: "M 120 52 L 150 52 L 150 62 L 180 62" },
  ]);
});

test("computeConnectorLines follows logical task order rather than snake render order", () => {
  const overlay = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  overlay.getBoundingClientRect = () =>
    ({ left: 0, top: 0, right: 600, bottom: 400, width: 600, height: 400, x: 0, y: 0, toJSON() {} }) as DOMRect;

  const nodes = Array.from({ length: 6 }, (_, index) => {
    const node = document.createElement("div");
    const header = document.createElement("div");
    node.querySelector = ((selector: string) =>
      selector === '[data-role="card-header"]' ? header : null) as typeof node.querySelector;

    const positions = [
      { left: 0, top: 0 },
      { left: 200, top: 0 },
      { left: 400, top: 0 },
      { left: 400, top: 160 },
      { left: 200, top: 160 },
      { left: 0, top: 160 },
    ];
    const { left, top } = positions[index]!;

    node.getBoundingClientRect = () =>
      ({ left, top, right: left + 100, bottom: top + 100, width: 100, height: 100, x: left, y: top, toJSON() {} }) as DOMRect;
    header.getBoundingClientRect = () =>
      ({ left, top, right: left + 100, bottom: top + 20, width: 100, height: 20, x: left, y: top, toJSON() {} }) as DOMRect;

    return node;
  });

  const lines = computeConnectorLines(new Map(nodes.map((node, index) => [index, node] as const)), overlay, 3, 6);

  expect(lines[2]?.d).toBe("M 450 100 L 450 130 L 450 130 L 450 160");
  expect(lines[3]?.d).toBe("M 400 170 L 350 170 L 350 170 L 300 170");
});
