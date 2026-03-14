import type { HTMLAttributes, ReactNode } from "react";

import type { BadgeIntent } from "../types";

const intentClasses: Record<BadgeIntent, string> = {
  gray: "bg-gray-100 text-gray-700",
  blue: "bg-blue-100 text-blue-700",
  green: "bg-green-100 text-green-700",
  red: "bg-red-100 text-red-700",
  amber: "bg-yellow-100 text-yellow-700",
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
        "inline-flex items-center gap-1 rounded-sm px-2 py-[2px] text-xs font-medium",
        intentClasses[intent],
        className,
      ].join(" ")}
      {...props}
    >
      {children}
    </span>
  );
}
