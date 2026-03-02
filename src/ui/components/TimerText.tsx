import LiveText from "./LiveText";
import { fmtDuration } from "../../utils/duration";

export default function TimerText({
  startMs,
  endMs = null,
  granularity = "second",
  format = fmtDuration,
  className,
}: {
  startMs: number;
  endMs?: number | null;
  granularity?: "second" | "minute";
  format?: (ms: number) => string;
  className?: string;
}) {
  if (!startMs) {
    return <span className={className}>—</span>;
  }

  return (
    <LiveText
      className={className}
      cadenceMs={granularity === "second" ? 1_000 : 60_000}
      compute={(nowMs) => format(Math.max(0, (endMs ?? nowMs) - startMs))}
    />
  );
}
