import type { ProgressVariant } from "../types";

const variantClasses: Record<ProgressVariant, string> = {
  default: "bg-brand-600",
  running: "bg-brand-600",
  error: "bg-red-600",
  completed: "bg-brand-600",
  pending: "bg-gray-400",
};

export function Progress({
  value = 0,
  variant = "default",
  className = "",
}: {
  value?: number;
  variant?: ProgressVariant;
  className?: string;
}) {
  const pct = Math.max(0, Math.min(100, Number(value)));

  return (
    <div
      className={["h-2 w-full overflow-hidden rounded-sm bg-gray-200", className].join(" ")}
    >
      <div
        className={["h-full transition-all duration-300", variantClasses[variant]].join(" ")}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
