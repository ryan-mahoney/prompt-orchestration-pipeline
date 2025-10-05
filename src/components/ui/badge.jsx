import React from "react";
export function Badge({ children, intent = "gray", className = "", ...props }) {
  const intents = {
    gray: "border-slate-300 text-slate-700 bg-slate-100",
    blue: "border-blue-300 text-blue-800 bg-blue-100",
    green: "border-green-300 text-green-800 bg-green-100",
    red: "border-red-300 text-red-800 bg-red-100",
    amber: "border-amber-300 text-amber-900 bg-amber-100",
  };
  const cls = [
    "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
    intents[intent] || intents.gray,
    className,
  ].join(" ");
  return (
    <span className={cls} {...props}>
      {children}
    </span>
  );
}
