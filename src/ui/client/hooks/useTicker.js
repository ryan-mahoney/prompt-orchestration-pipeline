import { useState, useEffect, useRef } from "react";

/**
 * Reactive ticker hook that provides updating timestamp
 * @param {number} intervalMs - Update interval in milliseconds (default: 1000)
 * @returns {number} Current timestamp that updates on interval
 */
export function useTicker(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    // Set up interval to update timestamp
    const intervalId = setInterval(() => {
      setNow(Date.now());
    }, intervalMs);

    // Cleanup interval on unmount
    return () => {
      clearInterval(intervalId);
    };
  }, [intervalMs]);

  return now;
}

export default useTicker;
