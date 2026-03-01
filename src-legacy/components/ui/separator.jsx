import React from "react";
export function Separator({ className = "", ...p }) {
  return (
    <hr className={["my-4 border-slate-200", className].join(" ")} {...p} />
  );
}
