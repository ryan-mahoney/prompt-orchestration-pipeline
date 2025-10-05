import React from "react";
import { Button as RadixButton } from "@radix-ui/themes";

export function Button({
  variant = "solid",
  size = "2",
  className = "",
  ...props
}) {
  // Map custom variant names to Radix UI variants
  const radixVariant =
    variant === "solid"
      ? "solid"
      : variant === "outline"
        ? "outline"
        : variant === "ghost"
          ? "ghost"
          : variant === "secondary"
            ? "soft"
            : variant === "destructive"
              ? "solid"
              : "solid";

  // Map custom size names to Radix UI sizes
  const radixSize =
    size === "sm" ? "1" : size === "md" ? "2" : size === "lg" ? "3" : "2";

  // Map destructive variant to appropriate color
  const color = variant === "destructive" ? "red" : undefined;

  // Combine base classes with any additional className
  const combinedClassName = `transition-colors duration-200 ${className}`;

  return (
    <RadixButton
      variant={radixVariant}
      size={radixSize}
      color={color}
      className={combinedClassName}
      {...props}
    />
  );
}
