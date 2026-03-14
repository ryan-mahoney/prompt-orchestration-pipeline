import type { HTMLAttributes } from "react";

export function Separator({
  className = "",
  ...props
}: HTMLAttributes<HTMLHRElement>) {
  return <hr className={["my-4 border-gray-200", className].join(" ")} {...props} />;
}
