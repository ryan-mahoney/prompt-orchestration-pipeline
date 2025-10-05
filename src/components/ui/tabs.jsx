import React, { useState } from "react";
export function Tabs({ defaultValue, children, className = "" }) {
  const [value, setValue] = useState(defaultValue);
  return (
    <div className={className} data-state={value}>
      {React.Children.map(children, (c) =>
        React.cloneElement(c, { value, setValue })
      )}
    </div>
  );
}
export function TabsList({ children, className = "", value, setValue }) {
  return (
    <div className={["flex gap-2 border-b", className].join(" ")}>
      {React.Children.map(children, (c) =>
        React.cloneElement(c, { value, setValue })
      )}
    </div>
  );
}
export function TabsTrigger({
  value: tab,
  children,
  className = "",
  setValue,
  value,
}) {
  const active = value === tab;
  const cls = [
    "px-3 py-2 text-sm",
    active
      ? "border-b-2 border-slate-900 font-medium"
      : "text-slate-500 hover:text-slate-700",
    className,
  ].join(" ");
  return (
    <button className={cls} onClick={() => setValue(tab)}>
      {children}
    </button>
  );
}
export function TabsContent({ value: tab, value, children, className = "" }) {
  if (value !== tab) return null;
  return <div className={["pt-3", className].join(" ")}>{children}</div>;
}
