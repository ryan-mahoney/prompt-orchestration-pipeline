import { useState } from "react";

import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";

import { CopyableCode } from "./ui/CopyableCode";

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-");
}

export function MarkdownRenderer({
  content,
  className = "",
}: {
  content: string;
  className?: string;
}) {
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const handleCopy = async (code: string) => {
    await navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          h1: ({ children }) => {
            const text = String(children);
            return <h1 id={slugify(text)}>{children}</h1>;
          },
          h2: ({ children }) => {
            const text = String(children);
            return <h2 id={slugify(text)}>{children}</h2>;
          },
          h3: ({ children }) => {
            const text = String(children);
            return <h3 id={slugify(text)}>{children}</h3>;
          },
          ul: ({ children }) => <ul className="list-disc pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal pl-5">{children}</ol>,
          table: ({ children }) => <table>{children}</table>,
          blockquote: ({ children }) => <blockquote className="border-l-4 pl-4 italic">{children}</blockquote>,
          code: ({ children, className: codeClassName }) => {
            const code = String(children).replace(/\n$/, "");
            const isBlock = Boolean(codeClassName);
            if (!isBlock) {
              return <code>{children}</code>;
            }

            return (
              <div className="relative">
                <button type="button" aria-label="Copy code" onClick={() => handleCopy(code)}>
                  {copiedCode === code ? "Copied" : "Copy"}
                </button>
                <pre>
                  <code className={codeClassName}>{children}</code>
                </pre>
              </div>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

export default MarkdownRenderer;
