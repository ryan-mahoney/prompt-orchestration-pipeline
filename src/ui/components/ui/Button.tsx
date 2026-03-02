import type { ButtonHTMLAttributes, ReactNode } from "react";

import type { ButtonSize, ButtonVariant } from "../types";

const variantClasses: Record<ButtonVariant, string> = {
  solid:
    "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] hover:bg-[hsl(var(--primary-hover))] focus:ring-[hsl(var(--primary))]",
  soft:
    "border border-[hsl(var(--primary))]/20 bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary))]/15 focus:ring-[hsl(var(--primary))]",
  outline:
    "border border-[hsl(var(--border))] bg-transparent text-[hsl(var(--secondary-foreground))] hover:bg-[hsl(var(--secondary))] focus:ring-[hsl(var(--ring))]",
  ghost:
    "bg-transparent text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--secondary))] hover:text-[hsl(var(--secondary-foreground))] focus:ring-[hsl(var(--ring))]",
  destructive:
    "bg-[hsl(var(--destructive))] text-[hsl(var(--destructive-foreground))] hover:bg-[hsl(var(--destructive))]/90 focus:ring-[hsl(var(--destructive))]",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-sm",
  md: "px-4 py-2 text-base",
  lg: "px-6 py-3 text-lg",
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
        "inline-flex items-center justify-center rounded-md font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
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
