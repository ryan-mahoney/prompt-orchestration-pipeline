import React from "react";
import { Button as RadixButton } from "@radix-ui/themes";

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
  ...props
}) {
  // Map custom variant names to Radix UI variants
  const radixVariant =
    variant === "solid"
      ? "solid"
      : variant === "soft"
        ? "soft"
        : variant === "outline"
          ? "outline"
          : variant === "ghost"
            ? "ghost"
            : variant === "destructive"
              ? "solid"
              : "solid";

  // Map custom size names to Radix UI sizes
  const radixSize =
    size === "sm" ? "1" : size === "md" ? "2" : size === "lg" ? "3" : "2";

  // Map destructive variant to appropriate color
  const color = variant === "destructive" ? "red" : undefined;

  // Combine base classes with any additional className
  const combinedClassName = `transition-all duration-200 ${className}`;

  // Disable button when loading or explicitly disabled
  const isDisabled = disabled || loading;

  return (
    <RadixButton
      variant={radixVariant}
      size={radixSize}
      color={color}
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
    </RadixButton>
  );
}
