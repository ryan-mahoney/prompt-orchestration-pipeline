import React, { useRef, useEffect } from "react";
import { X, Copy, Check } from "lucide-react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneLight } from "react-syntax-highlighter/dist/esm/styles/prism";

export const SchemaPreviewPanel = ({
  fileName,
  type,
  content,
  loading,
  error,
  onClose,
}) => {
  const panelRef = useRef(null);
  const [copied, setCopied] = React.useState(false);

  const handleCopy = async () => {
    if (content) {
      try {
        await navigator.clipboard.writeText(content);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (error) {
        console.error("Failed to copy content to clipboard:", error);
      }
    }
  };

  useEffect(() => {
    if (panelRef.current) {
      panelRef.current.focus();
    }
  }, []);

  const handleKeyDown = (e) => {
    if (e.key === "Escape") {
      onClose();
    }
  };

  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      role="region"
      aria-label={`${type} preview for ${fileName}`}
      className="fixed bottom-0 left-0 right-0 h-[50%] bg-white border-t shadow-lg flex flex-col z-10"
    >
      <div className="flex items-center justify-between px-4 py-2 border-b bg-slate-50">
        <span className="font-medium text-sm">
          {fileName} ({type})
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={handleCopy}
            aria-label="Copy content"
            className="hover:bg-slate-200 rounded p-1"
            disabled={!content}
          >
            {copied ? (
              <Check className="h-4 w-4 text-green-600" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
          </button>
          <button
            onClick={onClose}
            aria-label="Close preview"
            className="hover:bg-slate-200 rounded p-1"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-auto p-4">
        {loading ? (
          <div className="text-sm text-muted-foreground">Loading...</div>
        ) : error ? (
          <div className="text-sm text-red-600">{error}</div>
        ) : content ? (
          <SyntaxHighlighter
            language="json"
            style={oneLight}
            customStyle={{
              margin: 0,
              background: "transparent",
              fontSize: "12px",
            }}
          >
            {content}
          </SyntaxHighlighter>
        ) : null}
      </div>
    </div>
  );
};
