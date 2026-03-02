import type { ConnectorLine } from "./types";

export function upperFirst(s: string): string {
  return s.length === 0 ? s : `${s[0]?.toUpperCase() ?? ""}${s.slice(1)}`;
}

export function formatStepName(id: string): string {
  return id
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => upperFirst(part))
    .join(" ");
}

export function computeVisualOrder(itemCount: number, cols: number): number[] {
  const order: number[] = [];
  const rows = Math.ceil(itemCount / cols);

  for (let row = 0; row < rows; row += 1) {
    const start = row * cols;
    const end = Math.min(start + cols, itemCount);
    const items = Array.from({ length: end - start }, (_, index) => start + index);
    const padding = Array.from({ length: cols - items.length }, () => -1);

    if (row % 2 === 0) {
      order.push(...items, ...padding);
    } else {
      order.push(...padding, ...items.reverse());
    }
  }

  return order;
}

export function computeConnectorLines(
  nodeRefs: Map<number, HTMLElement>,
  overlayEl: Element,
  cols: number,
  itemCount: number,
): ConnectorLine[] {
  const lines: ConnectorLine[] = [];
  const overlayBox = overlayEl.getBoundingClientRect();

  for (let currentIndex = 0; currentIndex < itemCount - 1; currentIndex += 1) {
    const nextIndex = currentIndex + 1;
    if (currentIndex === undefined || nextIndex === undefined) continue;

    const current = nodeRefs.get(currentIndex);
    const next = nodeRefs.get(nextIndex);
    if (current == null || next == null) continue;

    const currentBox = current.getBoundingClientRect();
    const nextBox = next.getBoundingClientRect();
    const currentHeaderBox = current.querySelector('[data-role="card-header"]')?.getBoundingClientRect();
    const nextHeaderBox = next.querySelector('[data-role="card-header"]')?.getBoundingClientRect();
    const row = Math.floor(currentIndex / cols);
    const sameRow = Math.floor(currentIndex / cols) === Math.floor(nextIndex / cols);
    const currentHeaderMidY = currentHeaderBox
      ? currentHeaderBox.top - overlayBox.top + currentHeaderBox.height / 2
      : currentBox.top - overlayBox.top + Math.min(24, currentBox.height / 6);
    const nextHeaderMidY = nextHeaderBox
      ? nextHeaderBox.top - overlayBox.top + nextHeaderBox.height / 2
      : nextBox.top - overlayBox.top + Math.min(24, nextBox.height / 6);

    if (sameRow) {
      const fromRight = row % 2 === 0;
      const startX = fromRight ? currentBox.right - overlayBox.left : currentBox.left - overlayBox.left;
      const endX = fromRight ? nextBox.left - overlayBox.left : nextBox.right - overlayBox.left;
      const startY = currentHeaderMidY;
      const endY = nextHeaderMidY;
      const midX = (startX + endX) / 2;
      lines.push({ d: `M ${startX} ${startY} L ${midX} ${startY} L ${midX} ${endY} L ${endX} ${endY}` });
      continue;
    }

    const startX = currentBox.left - overlayBox.left + currentBox.width / 2;
    const endX = nextBox.left - overlayBox.left + nextBox.width / 2;
    const startY = currentBox.bottom - overlayBox.top;
    const endY = nextBox.top - overlayBox.top;
    const midY = (startY + endY) / 2;
    lines.push({ d: `M ${startX} ${startY} L ${startX} ${midY} L ${endX} ${midY} L ${endX} ${endY}` });
  }

  return lines;
}

export function checkReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function computeEffectiveCols(
  containerWidth: number,
  breakpoint = 1024,
  defaultCols = 3,
): number {
  return containerWidth < breakpoint ? 1 : defaultCols;
}

export interface GeometryAdapter {
  observeResize(el: HTMLElement, callback: (entry: ResizeObserverEntry) => void): () => void;
  requestFrame(callback: () => void): void;
  matchesReducedMotion(): boolean;
}

export const defaultGeometryAdapter: GeometryAdapter = {
  observeResize(el, callback) {
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) callback(entry);
    });
    observer.observe(el);
    return () => observer.disconnect();
  },
  requestFrame(callback) {
    requestAnimationFrame(callback);
  },
  matchesReducedMotion() {
    return checkReducedMotion();
  },
};
