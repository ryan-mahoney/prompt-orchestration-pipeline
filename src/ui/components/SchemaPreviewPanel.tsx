import { useState } from "react";
import { Check, Copy, X } from "lucide-react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneLight } from "react-syntax-highlighter/dist/esm/styles/prism";

export function SchemaPreviewPanel({
  fileName,
  type,
  content,
  loading,
  error,
  onClose,
}: {
  fileName: string;
  type: string;
  content: string;
  loading: boolean;
  error: string | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-x-0 bottom-0 z-10 h-[50vh] border-t border-gray-200 bg-white shadow-md">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div>
          <p className="text-sm font-medium">{fileName}</p>
          <p className="text-xs text-gray-500">{type}</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={handleCopy} aria-label="Copy schema">
            {copied ? <Check className="h-4 w-4 text-brand-600" /> : <Copy className="h-4 w-4" />}
          </button>
          <button type="button" onClick={onClose} aria-label="Close schema preview">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="h-[calc(50vh-57px)] overflow-auto">
        {loading ? <div className="p-4 text-sm text-gray-500">Loading…</div> : null}
        {error ? <div className="p-4 text-sm text-red-700">{error}</div> : null}
        {!loading && !error ? (
          <SyntaxHighlighter language="json" style={oneLight} customStyle={{ margin: 0, minHeight: "100%" }}>
            {content}
          </SyntaxHighlighter>
        ) : null}
      </div>
    </div>
  );
}
