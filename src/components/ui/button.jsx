import React from "react";
export function Button({
  as: As = "button",
  variant = "solid",
  size = "md",
  className = "",
  ...props
}) {
  const base =
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium " +
    "transition-colors focus-visible:outline-none focus-visible:ring-2 " +
    "focus-visible:ring-slate-400 focus-visible:ring-offset-2 ring-offset-white " +
    "disabled:opacity-50 disabled:pointer-events-none";
  const sizes = { sm: "h-8 px-3", md: "h-9 px-4", lg: "h-10 px-6" };
  const variants = {
    solid: "bg-slate-900 text-white hover:bg-slate-800",
    outline:
      "border border-slate-300 bg-white text-slate-900 hover:bg-slate-50",
    ghost: "bg-transparent hover:bg-slate-100",
    secondary: "bg-slate-100 text-slate-900 hover:bg-slate-200",
    destructive: "bg-red-600 text-white hover:bg-red-500",
  };
  const cls = [
    base,
    sizes[size] || sizes.md,
    variants[variant] || variants.solid,
    className,
  ].join(" ");
  return <As className={cls} {...props} />;
}
