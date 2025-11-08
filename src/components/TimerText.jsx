import React, { useSyncExternalStore, useId, useState, useEffect } from "react";
import {
  subscribe,
  getSnapshot,
  getServerSnapshot,
  addCadenceHint,
  removeCadenceHint,
} from "../ui/client/time-store.js";
import { fmtDuration } from "../utils/duration.js";

/**
 * TimerText component for displaying live-updating durations without parent re-renders
 *
 * @param {Object} props
 * @param {number} props.startMs - Start timestamp in milliseconds
 * @param {number|null} props.endMs - End timestamp in milliseconds (null for ongoing timers)
 * @param {"second"|"minute"} props.granularity - Update granularity
 * @param {Function} props.format - Duration formatting function (defaults to fmtDuration)
 * @param {string} props.className - CSS className for styling
 */
export default function TimerText({
  startMs,
  endMs = null,
  granularity = "second",
  format = fmtDuration,
  className,
}) {
  const id = useId();

  // Get current time from the global time store
  const now = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  // Local state for the formatted text to avoid re-renders of parent
  const [displayText, setDisplayText] = useState(() => {
    // Initial text for SSR safety
    if (!startMs) return "—";
    const initialEnd = endMs ?? Date.now();
    const elapsed = Math.max(0, initialEnd - startMs);
    return format(elapsed);
  });

  // Register cadence hint and handle subscription
  useEffect(() => {
    if (!startMs) return;

    // Register cadence hint based on granularity
    const cadenceMs = granularity === "second" ? 1000 : 60_000;
    addCadenceHint(id, cadenceMs);

    // Cleanup function
    return () => {
      removeCadenceHint(id);
    };
  }, [id, granularity, startMs]);

  // Update display text when time changes (only for ongoing timers)
  useEffect(() => {
    if (!startMs) return;

    // If endMs is present, this is a completed timer - no further updates needed
    if (endMs !== null) return;

    // For ongoing timers, update the display text
    const elapsed = Math.max(0, now - startMs);
    setDisplayText(format(elapsed));
  }, [now, startMs, endMs, format]);

  // For completed timers, ensure the final duration is displayed
  useEffect(() => {
    if (!startMs || endMs === null) return;

    const elapsed = Math.max(0, endMs - startMs);
    setDisplayText(format(elapsed));
  }, [startMs, endMs, format]);

  // If no start time, show placeholder
  if (!startMs) {
    return <span className={className}>—</span>;
  }

  return <span className={className}>{displayText}</span>;
}
