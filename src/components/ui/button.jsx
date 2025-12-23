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
    solid: "bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-500",
    default: "bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-500",
    soft: "bg-blue-50 text-blue-900 hover:bg-blue-100 focus:ring-blue-500 border border-blue-200",
    outline:
      "border border-gray-300 text-gray-700 bg-transparent hover:bg-gray-50 focus:ring-gray-500",
    ghost: "text-gray-700 bg-transparent hover:bg-gray-100 focus:ring-gray-500",
    destructive: "bg-red-600 text-white hover:bg-red-700 focus:ring-red-500",
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
