import React, { useState } from "react";
import { Box, Code } from "@radix-ui/themes";
import { Button } from "./button.jsx";
import { Copy, Check } from "lucide-react";

/**
 * CopyableCode component - displays code with a copy button
 * Follows Tufte principles: minimal chrome, high data-ink ratio
 */
export function CopyableCode({
  children,
  className = "",
  block = false,
  size = "2",
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const text = typeof children === "string" ? children : String(children);
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (block) {
    return (
      <Box className={`relative group ${className}`}>
        <pre className="text-sm bg-gray-50 p-4 rounded-lg overflow-auto border border-gray-200 font-mono">
          {children}
        </pre>
        <Button
          size="sm"
          variant="ghost"
          onClick={handleCopy}
          className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity h-7 w-7 p-0"
          aria-label={copied ? "Copied" : "Copy code"}
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-green-600" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </Button>
      </Box>
    );
  }

  return (
    <span className={`inline-flex items-center gap-1 group ${className}`}>
      <Code size={size}>{children}</Code>
      <button
        onClick={handleCopy}
        className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 hover:bg-gray-100 rounded"
        aria-label={copied ? "Copied" : "Copy code"}
      >
        {copied ? (
          <Check className="h-3 w-3 text-green-600" />
        ) : (
          <Copy className="h-3 w-3 text-gray-500" />
        )}
      </button>
    </span>
  );
}

/**
 * CopyableCodeBlock - larger block display with syntax-like formatting
 */
export function CopyableCodeBlock({ children, className = "", maxHeight }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const text = typeof children === "string" ? children : String(children);
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Box className={`relative group ${className}`}>
      <pre
        className="text-sm bg-gray-50 p-4 rounded-lg overflow-auto border border-gray-200 font-mono leading-relaxed"
        style={maxHeight ? { maxHeight } : undefined}
      >
        {children}
      </pre>
      <Button
        size="sm"
        variant="ghost"
        onClick={handleCopy}
        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity h-8 px-2 bg-white/80 hover:bg-white border border-gray-200"
        aria-label={copied ? "Copied" : "Copy code"}
      >
        {copied ? (
          <>
            <Check className="h-3.5 w-3.5 text-green-600 mr-1" />
            <span className="text-xs text-green-600">Copied</span>
          </>
        ) : (
          <>
            <Copy className="h-3.5 w-3.5 mr-1" />
            <span className="text-xs">Copy</span>
          </>
        )}
      </Button>
    </Box>
  );
}

export default CopyableCode;
