import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTicker } from "../src/ui/client/hooks/useTicker.js";

describe("useTicker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns initial timestamp on mount", () => {
    const { result } = renderHook(() => useTicker(1000));

    expect(typeof result.current).toBe("number");
    expect(result.current).toBeGreaterThan(0);
  });

  it("updates timestamp on interval", () => {
    const { result } = renderHook(() => useTicker(1000));
    const initialTime = result.current;

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(result.current).toBeGreaterThan(initialTime);
  });

  it("cleans up interval on unmount", () => {
    const { result, unmount } = renderHook(() => useTicker(1000));
    const initialTime = result.current;

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current).toBeGreaterThan(initialTime);

    unmount();
    const timeAtUnmount = result.current;

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(result.current).toBe(timeAtUnmount);
  });
});
