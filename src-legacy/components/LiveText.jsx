import React, { useSyncExternalStore, useId, useState, useEffect } from "react";
import {
  subscribe,
  getSnapshot,
  getServerSnapshot,
  addCadenceHint,
  removeCadenceHint,
} from "../ui/client/time-store.js";

/**
 * LiveText component for displaying computed text that updates on a cadence
 *
 * @param {Object} props
 * @param {Function} props.compute - Function that takes nowMs and returns string to display
 * @param {number} props.cadenceMs - Update cadence in milliseconds (default 10000)
 * @param {string} props.className - CSS className for styling
 */
export default function LiveText({ compute, cadenceMs = 10000, className }) {
  const id = useId();

  // Get current time from the global time store
  const now = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  // Local state for the computed text to avoid re-renders of parent
  const [displayText, setDisplayText] = useState(() => {
    // Initial text for SSR safety
    return compute(Date.now());
  });

  // Register cadence hint and handle subscription
  useEffect(() => {
    // Register cadence hint
    addCadenceHint(id, cadenceMs);

    // Cleanup function
    return () => {
      removeCadenceHint(id);
    };
  }, [id, cadenceMs]);

  // Update display text when time changes
  useEffect(() => {
    setDisplayText(compute(now));
  }, [now, compute]);

  return <span className={className}>{displayText}</span>;
}
