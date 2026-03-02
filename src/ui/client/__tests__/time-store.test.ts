import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface TestDocument {
  visibilityState: DocumentVisibilityState;
  addEventListener: (type: string, listener: EventListener) => void;
  removeEventListener: (type: string, listener: EventListener) => void;
  dispatchEvent: (event: Event) => boolean;
}

interface TimeStoreModule {
  addCadenceHint: (id: string, ms: number) => void;
  getSnapshot: () => number;
  removeCadenceHint: (id: string) => void;
  subscribe: (listener: () => void) => () => void;
}

const documentListeners = new Map<string, Set<EventListener>>();
const globalWithDocument = globalThis as unknown as { document?: TestDocument };

function createDocument(): TestDocument {
  return {
    visibilityState: "visible",
    addEventListener(type, listener) {
      const listeners = documentListeners.get(type) ?? new Set<EventListener>();
      listeners.add(listener);
      documentListeners.set(type, listeners);
    },
    removeEventListener(type, listener) {
      documentListeners.get(type)?.delete(listener);
    },
    dispatchEvent(event) {
      for (const listener of documentListeners.get(event.type) ?? []) listener(event);
      return true;
    },
  };
}

async function loadModule(): Promise<TimeStoreModule> {
  return import(`../time-store.ts?case=${Date.now()}-${Math.random()}`);
}

describe("time store", () => {
  let previousDocument: TestDocument | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    documentListeners.clear();
    previousDocument = globalWithDocument.document;
    globalWithDocument.document = createDocument();
  });

  afterEach(() => {
    if (previousDocument === undefined) delete globalWithDocument.document;
    else globalWithDocument.document = previousDocument;
    documentListeners.clear();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("starts and stops with subscribers", async () => {
    const timeStore = await loadModule();
    const listener = vi.fn();
    const unsubscribe = timeStore.subscribe(listener);

    vi.advanceTimersByTime(60_000);
    expect(listener).toHaveBeenCalled();

    listener.mockClear();
    unsubscribe();
    vi.advanceTimersByTime(60_000);
    expect(listener).not.toHaveBeenCalled();
  });

  it("returns a floored epoch millisecond snapshot", async () => {
    const timeStore = await loadModule();
    expect(Number.isInteger(timeStore.getSnapshot())).toBe(true);
  });

  it("clamps cadence hints to one second minimum", async () => {
    const timeStore = await loadModule();
    const listener = vi.fn();
    timeStore.addCadenceHint("fast", 500);
    const unsubscribe = timeStore.subscribe(listener);

    vi.advanceTimersByTime(999);
    expect(listener).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    timeStore.removeCadenceHint("fast");
  });

  it("throttles to at least a minute in background tabs", async () => {
    const timeStore = await loadModule();
    const listener = vi.fn();
    globalWithDocument.document!.visibilityState = "hidden";
    globalWithDocument.document!.dispatchEvent(new Event("visibilitychange"));
    const unsubscribe = timeStore.subscribe(listener);

    let elapsed = 0;
    while (listener.mock.calls.length === 0 && elapsed <= 60_000) {
      vi.advanceTimersByTime(1);
      elapsed += 1;
    }

    const firstCallCount = listener.mock.calls.length;
    expect(firstCallCount).toBe(1);

    vi.advanceTimersByTime(59_999);
    expect(listener).toHaveBeenCalledTimes(firstCallCount);
    vi.advanceTimersByTime(1);
    expect(listener).toHaveBeenCalledTimes(firstCallCount + 1);

    unsubscribe();
  });

  it("recalculates interval when hints are removed", async () => {
    const timeStore = await loadModule();
    const listener = vi.fn();
    timeStore.addCadenceHint("fast", 1_000);
    timeStore.addCadenceHint("slow", 5_000);
    const unsubscribe = timeStore.subscribe(listener);

    vi.advanceTimersByTime(1_000);
    expect(listener).toHaveBeenCalledTimes(1);

    timeStore.removeCadenceHint("fast");
    listener.mockClear();
    vi.advanceTimersByTime(4_999);
    expect(listener).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    timeStore.removeCadenceHint("slow");
  });
});
