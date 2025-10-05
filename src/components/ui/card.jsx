import React from "react";
export function Card({ className = "", ...p }) {
  return (
    <div
      className={["rounded-xl border bg-white shadow-sm", className].join(" ")}
      {...p}
    />
  );
}
export function CardHeader({ className = "", ...p }) {
  return <div className={["p-4 border-b", className].join(" ")} {...p} />;
}
export function CardTitle({ className = "", ...p }) {
  return (
    <h3 className={["text-base font-semibold", className].join(" ")} {...p} />
  );
}
export function CardContent({ className = "", ...p }) {
  return <div className={["p-4", className].join(" ")} {...p} />;
}
