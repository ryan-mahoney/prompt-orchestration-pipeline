import type { ButtonHTMLAttributes, ReactNode } from "react";

import type { ButtonSize, ButtonVariant } from "../types";

const variantClasses: Record<ButtonVariant, string> = {
  solid:
    "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] hover:bg-[hsl(var(--primary-hover))] focus:ring-[hsl(var(--primary))]",
  soft:
    "bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 hover:border-gray-400 focus:ring-gray-300",
  outline:
    "bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 hover:border-gray-400 focus:ring-gray-300",
  ghost:
    "bg-transparent text-[#6d28d9] border-transparent hover:bg-[#f5f3ff] focus:ring-[#6d28d9]",
  destructive:
    "bg-white text-[#b91c1c] border border-[#b91c1c] hover:bg-[#fef2f2] focus:ring-[#b91c1c]",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-sm",
  md: "h-10 px-4 text-base",
  lg: "h-11 px-6 text-md",
};

export function Button({
  variant = "solid",
  size = "md",
  loading = false,
  className = "",
  disabled,
  children,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  children?: ReactNode;
}) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={[
        "inline-flex items-center justify-center rounded-md font-medium transition-all duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
        variantClasses[variant],
        sizeClasses[size],
        className,
      ].join(" ")}
      {...props}
    >
      {loading ? (
        <span className="inline-flex items-center gap-2">
          <span aria-hidden="true" className="animate-spin">
            ⟳
          </span>
          {children}
        </span>
      ) : (
        children
      )}
    </button>
  );
}
