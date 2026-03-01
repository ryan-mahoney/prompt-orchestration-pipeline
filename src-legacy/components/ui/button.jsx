import React from "react";

/**
 * Button Component
 *
 * Standardized button component following the Steel Terminal design system.
 * Use this component for all buttons instead of raw <button> tags.
 *
 * @see docs/button-standards.md for usage guidelines
 *
 * @param {string} variant - Button variant: solid, soft, outline, ghost, destructive
 * @param {string} size - Button size: sm, md, lg
 * @param {boolean} loading - Show loading state
 * @param {string} className - Additional CSS classes
 */
export function Button({
  variant = "solid",
  size = "md",
  loading = false,
  className = "",
  disabled,
  children,
  type = "button",
  ...props
}) {
  // Base classes for all buttons
  const baseClasses =
    "inline-flex items-center justify-center font-medium rounded-md transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed";

  // Variant styles using Steel Terminal theme colors
  const variantClasses = {
    solid:
      "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] hover:bg-[hsl(var(--primary-hover))] focus:ring-[hsl(var(--primary))]",
    default:
      "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] hover:bg-[hsl(var(--primary-hover))] focus:ring-[hsl(var(--primary))]",
    soft: "bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary))]/15 focus:ring-[hsl(var(--primary))] border border-[hsl(var(--primary))]/20",
    outline:
      "border border-[hsl(var(--border))] text-[hsl(var(--secondary-foreground))] bg-transparent hover:bg-[hsl(var(--secondary))] focus:ring-[hsl(var(--ring))]",
    ghost:
      "text-[hsl(var(--muted-foreground))] bg-transparent hover:bg-[hsl(var(--secondary))] hover:text-[hsl(var(--secondary-foreground))] focus:ring-[hsl(var(--ring))]",
    destructive:
      "bg-[hsl(var(--destructive))] text-[hsl(var(--destructive-foreground))] hover:bg-[hsl(var(--destructive))]/90 focus:ring-[hsl(var(--destructive))]",
  };

  // Size styles
  const sizeClasses = {
    sm: "px-3 py-1.5 text-sm",
    md: "px-4 py-2 text-base",
    lg: "px-6 py-3 text-lg",
  };

  // Disable button when loading or explicitly disabled
  const isDisabled = disabled || loading;

  // Combine all classes
  const combinedClassName = `${baseClasses} ${variantClasses[variant]} ${sizeClasses[size]} ${className}`;

  return (
    <button
      type={type}
      className={combinedClassName}
      disabled={isDisabled}
      {...props}
    >
      {loading ? (
        <span className="inline-flex items-center gap-2">
          <span className="animate-spin">⟳</span>
          {children}
        </span>
      ) : (
        children
      )}
    </button>
  );
}
