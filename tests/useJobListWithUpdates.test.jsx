import React from "react";
import { render, screen, act, cleanup, waitFor } from "@testing-library/react";
import { vi, beforeEach, afterEach, describe, it, expect } from "vitest";

// Mock the base hook used by the implementation so tests can control returned snapshot
let baseReturn = {
  loading: false,
  data: null,
  error: null,
  refetch: () => {},
};

vi.mock("../src/ui/client/hooks/useJobList.js", () => {
  return {
    useJobList: () => baseReturn,
  };
});

// Keep a simple EventSource fake that allows tests to assert construction and emit events.
class FakeEventSource {
  constructor(url) {
    this.url = url;
    this.readyState = 0; // 0 connecting, 1 open, 2 closed
    this._listeners = Object.create(null);
    FakeEventSource.instances.push(this);
  }

  addEventListener(name, cb) {
    if (!this._listeners[name]) this._listeners[name] = [];
    this._listeners[name].push(cb);
    // Debug: track listener registration count
    // eslint-disable-next-line no-console
    console.debug(
      "[FakeEventSource] addEventListener",
      name,
      this._listeners[name].length
    );
  }
  removeEventListener(name, cb) {
    if (!this._listeners[name]) return;
    this._listeners[name] = this._listeners[name].filter((f) => f !== cb);
    // eslint-disable-next-line no-console
    console.debug(
      "[FakeEventSource] removeEventListener",
      name,
      this._listeners[name]?.length || 0
    );
  }
  close() {
    this.readyState = 2;
    // eslint-disable-next-line no-console
    console.debug("[FakeEventSource] close");
  }
  dispatchEvent(name, evt = {}) {
    const list = this._listeners[name] || [];
    // Debug: log dispatch and listener count
    // eslint-disable-next-line no-console
    console.debug(
      "[FakeEventSource] dispatchEvent",
      name,
      "listeners=",
      list.length,
      "evt=",
      evt
    );
    // Call listeners synchronously for deterministic behavior in tests
    list.forEach((fn) => {
      try {
        fn(evt);
      } catch (e) {
        // swallow - mirrors real-world behavior in tests
      }
    });
  }
}
FakeEventSource.instances = [];
let __OriginalEventSource;

// Replace global EventSource in tests
beforeEach(() => {
  // Preserve any existing global EventSource and switch this suite to real timers
  __OriginalEventSource = global.EventSource;
  FakeEventSource.instances = [];
  // Use real timers in this test file so waitFor and async timing behave normally
  vi.useRealTimers();
  // Use vi.fn so we can assert it was called
  global.EventSource = vi.fn((url) => new FakeEventSource(url));
});
afterEach(() => {
  // Ensure DOM is cleaned up between tests to avoid multiple mounted components
  cleanup();

  // Restore original global EventSource and switch timers back to fake so other tests keep using fake timers
  // eslint-disable-next-line no-undef
  global.EventSource = __OriginalEventSource;
  // Re-enable fake timers for the remaining test suite
  vi.useFakeTimers();
});

// Import the hook under test after we've set up the mocks above
import { useJobListWithUpdates } from "../src/ui/client/hooks/useJobListWithUpdates.js";

function TestComp() {
  const { data, connectionStatus } = useJobListWithUpdates();
  const count = Array.isArray(data) ? data.length : 0;
  return (
    <div>
      <div data-testid="status">{connectionStatus}</div>
      <div data-testid="count">{String(count)}</div>
      <ul data-testid="list">
        {Array.isArray(data)
          ? data.map((j) => <li key={j.id}>{j.id}</li>)
          : null}
      </ul>
    </div>
  );
}

describe("useJobListWithUpdates (SSE behavior)", () => {
  it("opens SSE even when base data is empty and applies created events", async () => {
    baseReturn = { loading: false, data: [], error: null, refetch: () => {} };

    render(<TestComp />);

    // EventSource should be constructed on mount
    expect(global.EventSource).toHaveBeenCalledWith("/api/events");
    expect(FakeEventSource.instances.length).toBe(1);

    const es = FakeEventSource.instances[FakeEventSource.instances.length - 1];

    // Simulate server sending job:created
    act(() => {
      es.dispatchEvent("job:created", {
        data: JSON.stringify({
          id: "j-1",
          title: "One",
          status: "pending",
          createdAt: "2020-01-01T00:00:00.000Z",
        }),
      });
    });

    // The component should show the new job count (wait for state updates)
    await waitFor(() => {
      expect(screen.getByTestId("count").textContent).toBe("1");
    });
    await waitFor(() => {
      expect(screen.getByTestId("list").textContent).toContain("j-1");
    });
  });

  it("opens SSE when jobs API errors and reports connectionStatus on open", async () => {
    baseReturn = {
      loading: false,
      data: [],
      error: new Error("API down"),
      refetch: () => {},
    };

    render(<TestComp />);

    expect(global.EventSource).toHaveBeenCalledWith("/api/events");
    const es = FakeEventSource.instances[FakeEventSource.instances.length - 1];

    // Simulate open
    act(() => {
      es.readyState = 1;
      es.dispatchEvent("open", {});
    });

    // connectionStatus should update to "connected"
    await waitFor(() => {
      expect(screen.getByTestId("status").textContent).toBe("connected");
    });
  });

  it("queues SSE events before hydration and applies them after hydration (including empty array)", async () => {
    // Start in loading state (not hydrated)
    baseReturn = { loading: true, data: null, error: null, refetch: () => {} };

    const { rerender } = render(<TestComp />);

    const es = FakeEventSource.instances[FakeEventSource.instances.length - 1];

    // Emit an event while not hydrated
    act(() => {
      es.dispatchEvent("job:created", {
        data: JSON.stringify({
          id: "queued-1",
          title: "Queued",
          status: "pending",
          createdAt: "2020-01-01T00:00:00.000Z",
        }),
      });
    });

    // Still no jobs applied yet
    await waitFor(() => {
      expect(screen.getByTestId("count").textContent).toBe("0");
    });

    // Now simulate hydration to an empty array
    baseReturn = { loading: false, data: [], error: null, refetch: () => {} };

    // Trigger re-render so the hook reads the new baseReturn
    act(() => {
      rerender(<TestComp />);
    });

    // After hydration, queued event(s) should be applied to localData
    await waitFor(() => {
      expect(screen.getByTestId("count").textContent).toBe("1");
    });
    await waitFor(() => {
      expect(screen.getByTestId("list").textContent).toContain("queued-1");
    });
  });

  it("refetches on seed:uploaded and debounces multiple events", async () => {
    // Prepare a hydrated base with a spyable refetch
    baseReturn = { loading: false, data: [], error: null, refetch: vi.fn() };

    render(<TestComp />);

    const es = FakeEventSource.instances[FakeEventSource.instances.length - 1];

    // Dispatch two rapid seed:uploaded events; debounce should coalesce to a single refetch
    act(() => {
      es.dispatchEvent("seed:uploaded", {
        data: JSON.stringify({ name: "job-x" }),
      });
      es.dispatchEvent("seed:uploaded", {
        data: JSON.stringify({ name: "job-y" }),
      });
    });

    // Wait for the debounced refetch to be called once (allow up to 1s)
    await waitFor(
      () => {
        expect(baseReturn.refetch).toHaveBeenCalledTimes(1);
      },
      { timeout: 1000 }
    );
  });
});
