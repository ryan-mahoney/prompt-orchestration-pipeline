import React from "react";
export function Progress({ value = 0, className = "" }) {
  const pct = Math.max(0, Math.min(100, Number(value)));
  return (
    <div
      className={[
        "h-2 w-full overflow-hidden rounded bg-slate-200",
        className,
      ].join(" ")}
    >
      <div className="h-full bg-blue-600" style={{ width: `${pct}%` }} />
    </div>
  );
}
