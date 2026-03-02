import { useEffect, useRef, useSyncExternalStore } from "react";

import {
  addCadenceHint,
  getServerSnapshot,
  getSnapshot,
  removeCadenceHint,
  subscribe,
} from "../client/time-store";

export default function LiveText({
  compute,
  cadenceMs = 10_000,
  className,
}: {
  compute: (nowMs: number) => string;
  cadenceMs?: number;
  className?: string;
}) {
  const idRef = useRef(`live-text-${Math.random().toString(36).slice(2)}`);
  const now = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    addCadenceHint(idRef.current, cadenceMs);
    return () => removeCadenceHint(idRef.current);
  }, [cadenceMs]);

  return <span className={className}>{compute(now)}</span>;
}
