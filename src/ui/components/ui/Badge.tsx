import type { HTMLAttributes, ReactNode } from "react";

import type { BadgeIntent } from "../types";

const intentClasses: Record<BadgeIntent, string> = {
  gray: "border-slate-300 bg-slate-100 text-slate-700",
  blue: "border-blue-300 bg-blue-100 text-blue-800",
  green: "border-green-300 bg-green-100 text-green-800",
  red: "border-red-300 bg-red-100 text-red-800",
  amber: "border-amber-300 bg-amber-100 text-amber-900",
};

export function Badge({
  intent = "gray",
  children,
  className = "",
  ...props
}: HTMLAttributes<HTMLSpanElement> & {
  intent?: BadgeIntent;
  children: ReactNode;
}) {
  return (
    <span
      className={[
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
        intentClasses[intent],
        className,
      ].join(" ")}
      {...props}
    >
      {children}
    </span>
  );
}
