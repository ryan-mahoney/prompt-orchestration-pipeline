import React from "react";
export function Progress({ value = 0, variant = "default", className = "" }) {
  const pct = Math.max(0, Math.min(100, Number(value)));

  const variantClasses = {
    default: "bg-blue-600",
    running: "bg-blue-600",
    error: "bg-red-600",
    completed: "bg-green-600",
    pending: "bg-slate-400",
  };

  return (
    <div
      className={[
        "h-2 w-full overflow-hidden rounded bg-slate-200",
        className,
      ].join(" ")}
    >
      <div
        className={`h-full transition-all duration-300 ${variantClasses[variant] || variantClasses.default}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
