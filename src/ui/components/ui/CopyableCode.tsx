import { useState } from "react";

import { Check, Copy } from "lucide-react";

import { Button } from "./Button";

type CopyableCodeProps = {
  children: string;
  className?: string;
};

export function CopyableCode({ children, className = "" }: CopyableCodeProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(children);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <span className={["inline-flex items-center gap-1 group", className].join(" ")}>
      <code>{children}</code>
      <button
        type="button"
        onClick={handleCopy}
        className="rounded p-0.5 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-gray-100"
        aria-label={copied ? "Copied" : "Copy code"}
      >
        {copied ? <Check className="h-3 w-3 text-brand-600" /> : <Copy className="h-3 w-3 text-gray-500" />}
      </button>
    </span>
  );
}

export function CopyableCodeBlock({
  children,
  className = "",
  size,
  maxHeight,
}: CopyableCodeProps & {
  size?: string;
  maxHeight?: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(children);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={["relative group", className].join(" ")}>
      <pre
        className="overflow-auto rounded-md border border-gray-200 bg-gray-50 p-4 font-mono text-sm leading-relaxed"
        style={{
          maxHeight,
          fontSize: size,
        }}
      >
        {children}
      </pre>
      <Button
        size="sm"
        variant="ghost"
        onClick={handleCopy}
        className="absolute right-2 top-2 h-8 border border-gray-200 bg-gray-50/90 px-2 hover:bg-gray-100"
        aria-label={copied ? "Copied" : "Copy code"}
      >
        {copied ? (
          <>
            <Check className="mr-1 h-3.5 w-3.5 text-brand-600" />
            <span className="text-xs text-brand-600">Copied</span>
          </>
        ) : (
          <>
            <Copy className="mr-1 h-3.5 w-3.5" />
            <span className="text-xs">Copy</span>
          </>
        )}
      </Button>
    </div>
  );
}
