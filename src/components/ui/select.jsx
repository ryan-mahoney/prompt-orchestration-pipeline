import React from "react";
export function Select({ value, onValueChange, children, className = "" }) {
  return (
    <select
      className={[
        "h-9 rounded-md border px-3 text-sm bg-white",
        className,
      ].join(" ")}
      value={value}
      onChange={(e) => onValueChange?.(e.target.value)}
    >
      {children}
    </select>
  );
}
export function SelectItem({ value, children }) {
  return <option value={value}>{children}</option>;
}
export function SelectTrigger({ children, ...p }) {
  return <>{children}</>;
} // keep API compatible
export function SelectContent({ children }) {
  return <>{children}</>;
}
export function SelectValue({ placeholder }) {
  return <>{placeholder}</>;
}
