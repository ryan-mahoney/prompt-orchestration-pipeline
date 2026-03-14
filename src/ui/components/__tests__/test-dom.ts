import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/",
});

Object.defineProperties(globalThis, {
  window: { value: dom.window as unknown as Window & typeof globalThis, configurable: true, writable: true },
  document: { value: dom.window.document, configurable: true, writable: true },
  navigator: { value: dom.window.navigator, configurable: true, writable: true },
  HTMLElement: { value: dom.window.HTMLElement, configurable: true, writable: true },
  HTMLButtonElement: { value: dom.window.HTMLButtonElement, configurable: true, writable: true },
  HTMLInputElement: { value: dom.window.HTMLInputElement, configurable: true, writable: true },
  SVGElement: { value: dom.window.SVGElement, configurable: true, writable: true },
  localStorage: { value: dom.window.localStorage, configurable: true, writable: true },
  Node: { value: dom.window.Node, configurable: true, writable: true },
  NodeFilter: { value: dom.window.NodeFilter, configurable: true, writable: true },
  Event: { value: dom.window.Event, configurable: true, writable: true },
  MouseEvent: { value: dom.window.MouseEvent, configurable: true, writable: true },
  CustomEvent: { value: dom.window.CustomEvent, configurable: true, writable: true },
  Document: { value: dom.window.Document, configurable: true, writable: true },
  MutationObserver: { value: dom.window.MutationObserver, configurable: true, writable: true },
  requestAnimationFrame: {
    value: (((callback: FrameRequestCallback) => setTimeout(() => callback(Date.now()), 16)) as unknown) as typeof requestAnimationFrame,
    configurable: true,
    writable: true,
  },
  cancelAnimationFrame: {
    value: (((id: number) => clearTimeout(id)) as unknown) as typeof cancelAnimationFrame,
    configurable: true,
    writable: true,
  },
});
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

Object.defineProperty(globalThis, "getComputedStyle", {
  value: dom.window.getComputedStyle.bind(dom.window),
  configurable: true,
});

Object.defineProperty(globalThis.window, "matchMedia", {
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
  configurable: true,
  writable: true,
});

Object.defineProperty(globalThis, "ResizeObserver", {
  value: class ResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  },
  configurable: true,
  writable: true,
});
